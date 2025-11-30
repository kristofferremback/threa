-- ============================================================================
-- Memory System Migration
-- ============================================================================
-- Implements GAM-inspired memory architecture:
-- - Memos: lightweight pointers to valuable conversations (replaces knowledge)
-- - Contextual headers: enriched message context for better retrieval
-- - Retrieval log: track what gets retrieved for system evolution
-- - Expertise signals: track who knows what
-- ============================================================================

-- ============================================================================
-- 1. DROP OLD KNOWLEDGE SYSTEM
-- ============================================================================

-- Drop knowledge-related objects
DROP TABLE IF EXISTS knowledge_feedback CASCADE;
DROP TABLE IF EXISTS knowledge_embeddings_768 CASCADE;
DROP TABLE IF EXISTS knowledge_embeddings_1536 CASCADE;
DROP TRIGGER IF EXISTS knowledge_search_vector_update ON knowledge;
DROP FUNCTION IF EXISTS knowledge_search_vector_trigger();
DROP TABLE IF EXISTS knowledge CASCADE;

-- Clean up streams classification columns (no longer needed with memo system)
ALTER TABLE streams DROP COLUMN IF EXISTS last_classified_at;
ALTER TABLE streams DROP COLUMN IF EXISTS classification_result;
ALTER TABLE streams DROP COLUMN IF EXISTS knowledge_extracted_at;

-- ============================================================================
-- 2. MEMOS TABLE (replaces knowledge)
-- ============================================================================
-- Memos are lightweight pointers to valuable conversations, not extracted content.
-- They help find where answers live; Ariadne synthesizes at query time.

CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What this memo is about (short, searchable summary)
  summary TEXT NOT NULL,
  topics TEXT[] DEFAULT '{}',

  -- Pointers to source conversations (NOT extracted content)
  anchor_event_ids TEXT[] NOT NULL,           -- Key messages that make this valuable
  context_stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
  context_start_event_id TEXT,                -- Conversation window start
  context_end_event_id TEXT,                  -- Conversation window end

  -- Participants (for expert routing)
  participant_ids TEXT[] DEFAULT '{}',
  primary_answerer_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- Retrieval metadata (evolves over time)
  confidence REAL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  retrieval_count INTEGER DEFAULT 0,
  last_retrieved_at TIMESTAMPTZ,
  helpfulness_score REAL DEFAULT 0,           -- Accumulated from feedback

  -- Provenance
  source TEXT NOT NULL CHECK (source IN ('user', 'system', 'ariadne')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Visibility (inherits search scope logic)
  visibility TEXT NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('workspace', 'channel', 'private')),
  visible_to_stream_ids TEXT[] DEFAULT '{}',  -- If channel/private scoped

  -- Soft delete
  archived_at TIMESTAMPTZ,

  -- Embedding for semantic search over memos
  embedding vector(1536),

  -- Full-text search
  search_vector tsvector
);

-- Indexes for memo queries
CREATE INDEX idx_memos_workspace ON memos(workspace_id) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_workspace_created ON memos(workspace_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_topics ON memos USING gin(topics) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_confidence ON memos(workspace_id, confidence DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_embedding ON memos USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_memos_search ON memos USING gin(search_vector);
CREATE INDEX idx_memos_anchor_events ON memos USING gin(anchor_event_ids);
CREATE INDEX idx_memos_context_stream ON memos(context_stream_id) WHERE context_stream_id IS NOT NULL;
CREATE INDEX idx_memos_visibility ON memos(workspace_id, visibility) WHERE archived_at IS NULL;

-- Search vector trigger for memos
CREATE OR REPLACE FUNCTION memos_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.summary, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.topics, ' '), '')), 'B');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memos_search_vector_update
  BEFORE INSERT OR UPDATE OF summary, topics ON memos
  FOR EACH ROW EXECUTE FUNCTION memos_search_vector_trigger();

COMMENT ON TABLE memos IS 'Lightweight pointers to valuable conversations for JIT knowledge retrieval';
COMMENT ON COLUMN memos.anchor_event_ids IS 'Key message IDs that make this conversation valuable';
COMMENT ON COLUMN memos.confidence IS 'Retrieval confidence score, evolves based on usage feedback';

-- ============================================================================
-- 3. CONTEXTUAL HEADERS ON TEXT_MESSAGES
-- ============================================================================
-- Contextual headers capture conversation context for better embeddings.
-- Generated lazily when signals indicate value (reactions, replies, retrieval).

ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS contextual_header TEXT;
ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS header_generated_at TIMESTAMPTZ;
ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS enrichment_tier INTEGER DEFAULT 0;
  -- 0: not processed
  -- 1: basic embedding only
  -- 2: contextual header generated

ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS enrichment_signals JSONB DEFAULT '{}';
  -- Tracks why we enriched: {"reactions": 3, "replies": 2, "retrieved": true}

-- Index for finding messages that need enrichment
CREATE INDEX idx_text_messages_enrichment_tier
  ON text_messages(enrichment_tier)
  WHERE enrichment_tier < 2;

COMMENT ON COLUMN text_messages.contextual_header IS 'AI-generated context about the conversation this message belongs to';
COMMENT ON COLUMN text_messages.enrichment_tier IS '0=unprocessed, 1=basic embedding, 2=contextual header';
COMMENT ON COLUMN text_messages.enrichment_signals IS 'Signals that triggered enrichment: reactions, replies, retrieved';

-- ============================================================================
-- 4. RETRIEVAL LOG (for system evolution)
-- ============================================================================
-- Tracks what gets retrieved to learn what's valuable and identify coverage gaps.

CREATE TABLE retrieval_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- The query
  query TEXT NOT NULL,
  query_embedding vector(1536),
  requester_type TEXT NOT NULL CHECK (requester_type IN ('ariadne', 'user', 'system')),
  requester_id TEXT,  -- user_id or null for system

  -- What was retrieved
  retrieved_memo_ids TEXT[] DEFAULT '{}',
  retrieved_event_ids TEXT[] DEFAULT '{}',
  retrieval_scores JSONB DEFAULT '{}',  -- {id: score, ...}

  -- Synthesis (if Ariadne)
  session_id TEXT,  -- Reference to agent_sessions
  response_event_id TEXT,
  iteration_count INTEGER DEFAULT 1,

  -- Outcome feedback
  user_feedback TEXT CHECK (user_feedback IN ('positive', 'negative', 'neutral')),
  feedback_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for evolution queries
CREATE INDEX idx_retrieval_log_workspace ON retrieval_log(workspace_id, created_at DESC);
CREATE INDEX idx_retrieval_log_memos ON retrieval_log USING gin(retrieved_memo_ids);
CREATE INDEX idx_retrieval_log_events ON retrieval_log USING gin(retrieved_event_ids);
CREATE INDEX idx_retrieval_log_feedback ON retrieval_log(workspace_id, user_feedback)
  WHERE user_feedback IS NOT NULL;
CREATE INDEX idx_retrieval_log_session ON retrieval_log(session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON TABLE retrieval_log IS 'Tracks retrieval queries and outcomes for system evolution';
COMMENT ON COLUMN retrieval_log.iteration_count IS 'How many search iterations Ariadne needed';

-- ============================================================================
-- 5. EXPERTISE SIGNALS
-- ============================================================================
-- Tracks who knows what based on accumulated signals from conversations.

CREATE TABLE expertise_signals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  topic TEXT NOT NULL,

  -- Signal sources (accumulated counts)
  questions_answered INTEGER DEFAULT 0,
  answers_cited_by_ariadne INTEGER DEFAULT 0,
  positive_reactions_received INTEGER DEFAULT 0,
  answers_marked_helpful INTEGER DEFAULT 0,

  -- Computed score (updated by evolution job)
  expertise_score REAL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, user_id, topic)
);

CREATE INDEX idx_expertise_workspace_topic ON expertise_signals(workspace_id, topic, expertise_score DESC);
CREATE INDEX idx_expertise_user ON expertise_signals(user_id);

COMMENT ON TABLE expertise_signals IS 'Tracks who knows what based on conversation signals';
COMMENT ON COLUMN expertise_signals.expertise_score IS 'Computed score combining all signals, decays over time';

-- ============================================================================
-- 6. MEMO EMBEDDINGS TABLE (dimension-flexible like messages)
-- ============================================================================
-- Separate table allows switching embedding providers without migration

CREATE TABLE memo_embeddings_768 (
  memo_id TEXT PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE memo_embeddings_1536 (
  memo_id TEXT PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_memo_embeddings_768 ON memo_embeddings_768
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_memo_embeddings_1536 ON memo_embeddings_1536
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 7. UPDATE JOB QUEUE TYPES (add memory jobs)
-- ============================================================================
-- Note: pg-boss handles job types dynamically, no schema change needed.
-- New job types: memory.enrich, memory.create-memo, memory.evolve

COMMENT ON TABLE retrieval_log IS 'New job types for memory system: memory.enrich, memory.create-memo, memory.evolve';

-- ============================================================================
-- AI Features Migration
-- ============================================================================
-- Adds: embeddings, knowledge base, AI usage tracking, personas
-- ============================================================================

-- ============================================================================
-- 1. EMBEDDINGS ON TEXT_MESSAGES
-- ============================================================================

-- Add embedding column for vector search
ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- IVFFlat index for approximate nearest neighbor search
-- lists=100 is good for up to ~1M vectors
CREATE INDEX IF NOT EXISTS idx_text_messages_embedding 
    ON text_messages USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100);

-- Full-text search vector for hybrid search
ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_text_messages_search 
    ON text_messages USING gin(search_vector);

-- ============================================================================
-- 2. AI USAGE TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_usage (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT,  -- NULL for system-triggered jobs (e.g., embeddings)
    
    -- Job classification
    job_type TEXT NOT NULL,  -- 'embed', 'classify', 'respond', 'extract'
    model TEXT NOT NULL,     -- 'granite4:350m', 'claude-sonnet-4', 'text-embedding-3-small', etc.
    
    -- Token usage
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT,  -- NULL for embeddings
    
    -- Cost tracking (in cents, with precision for cheap operations)
    cost_cents NUMERIC(10,6) NOT NULL DEFAULT 0,
    
    -- Context (what was this job for?)
    stream_id TEXT,
    event_id TEXT,
    job_id TEXT,  -- Reference to pg-boss job if applicable
    
    -- Metadata for debugging/analysis
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_month 
    ON ai_usage(workspace_id, DATE_TRUNC('month', created_at));
CREATE INDEX IF NOT EXISTS idx_ai_usage_user 
    ON ai_usage(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_job_type 
    ON ai_usage(job_type, created_at);

COMMENT ON TABLE ai_usage IS 'Tracks all AI API calls and costs for billing and analytics';
COMMENT ON COLUMN ai_usage.cost_cents IS 'Cost in cents with 6 decimal precision for micro-transactions';

-- ============================================================================
-- 3. KNOWLEDGE BASE
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    
    -- Content
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,  -- Markdown
    
    -- Source tracking
    source_stream_id TEXT,  -- The stream/thread this was extracted from
    source_event_id TEXT,   -- The anchor message
    
    -- Search indexes
    embedding vector(1536),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', summary), 'B') ||
        setweight(to_tsvector('english', content), 'C')
    ) STORED,
    
    -- Authorship
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    
    -- Feedback and usage
    view_count INT NOT NULL DEFAULT 0,
    helpful_count INT NOT NULL DEFAULT 0,
    not_helpful_count INT NOT NULL DEFAULT 0,
    
    -- For future versioning/staleness tracking
    last_verified_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_knowledge_workspace ON knowledge(workspace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_workspace_active 
    ON knowledge(workspace_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding 
    ON knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_knowledge_search 
    ON knowledge USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_stream ON knowledge(source_stream_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_event ON knowledge(source_event_id);

COMMENT ON TABLE knowledge IS 'Extracted institutional knowledge from conversations';
COMMENT ON COLUMN knowledge.search_vector IS 'Weighted tsvector: title (A), summary (B), content (C)';

-- ============================================================================
-- 4. AI PERSONAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_personas (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,  -- NULL = global default persona
    
    -- Identity
    name TEXT NOT NULL DEFAULT 'Ariadne',
    handle TEXT NOT NULL DEFAULT 'ariadne',  -- Without @ prefix
    avatar_url TEXT,
    
    -- Behavior
    system_prompt TEXT NOT NULL,
    custom_instructions TEXT,  -- Workspace-specific additions
    
    -- Model preferences
    model_preference TEXT NOT NULL DEFAULT 'claude-sonnet-4',
    temperature NUMERIC(2,1) DEFAULT 0.7,
    max_tool_calls INT DEFAULT 5,
    
    -- State
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_personas_workspace_default 
    ON ai_personas(workspace_id) WHERE is_default = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_personas_workspace ON ai_personas(workspace_id);

COMMENT ON TABLE ai_personas IS 'AI assistant personas with customizable behavior';

-- Insert default Ariadne persona
INSERT INTO ai_personas (id, workspace_id, name, handle, system_prompt, is_default)
VALUES (
    'pers_default_ariadne',
    NULL,  -- Global default
    'Ariadne',
    'ariadne',
    'You are Ariadne, a helpful AI assistant for the Threa workspace platform. Your name comes from Greek mythology - Ariadne gave Theseus the thread that guided him through the labyrinth. Similarly, you help guide people through the complexity of their organization''s knowledge and conversations.

Your role:
- Answer questions by searching the knowledge base and past conversations
- Be concise and helpful - respect people''s time
- Always cite your sources when referencing knowledge or past conversations
- If you''re not sure about something, say so clearly
- Back off gracefully when humans are actively helping each other

Style:
- Friendly but professional
- Use markdown formatting when helpful
- Provide code examples when relevant
- Keep responses focused and scannable',
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. CLASSIFICATION TRACKING ON STREAMS
-- ============================================================================

ALTER TABLE streams ADD COLUMN IF NOT EXISTS last_classified_at TIMESTAMPTZ;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS classification_result TEXT;  -- 'knowledge_candidate', 'not_applicable'
ALTER TABLE streams ADD COLUMN IF NOT EXISTS knowledge_extracted_at TIMESTAMPTZ;

COMMENT ON COLUMN streams.last_classified_at IS 'When this stream was last checked for knowledge candidates';
COMMENT ON COLUMN streams.classification_result IS 'Result of last classification: knowledge_candidate or not_applicable';
COMMENT ON COLUMN streams.knowledge_extracted_at IS 'When knowledge was extracted from this stream (prevents re-classification)';

-- ============================================================================
-- 6. WORKSPACE AI SETTINGS
-- ============================================================================

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_budget_cents_monthly INT NOT NULL DEFAULT 10000;  -- $100 default

COMMENT ON COLUMN workspaces.ai_enabled IS 'Whether AI features are enabled for this workspace';
COMMENT ON COLUMN workspaces.ai_budget_cents_monthly IS 'Monthly AI spending limit in cents';

-- ============================================================================
-- 7. KNOWLEDGE FEEDBACK
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge_feedback (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    
    feedback_type TEXT NOT NULL,  -- 'helpful', 'not_helpful', 'outdated', 'incorrect'
    comment TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_feedback_knowledge ON knowledge_feedback(knowledge_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_feedback_user_knowledge 
    ON knowledge_feedback(knowledge_id, user_id, feedback_type);

COMMENT ON TABLE knowledge_feedback IS 'User feedback on knowledge quality';

-- ============================================================================
-- 8. COMMENTS
-- ============================================================================

COMMENT ON COLUMN text_messages.embedding IS '1536-dim vector from text-embedding-3-small for semantic search';
COMMENT ON COLUMN text_messages.embedded_at IS 'When the embedding was generated (NULL = needs embedding)';


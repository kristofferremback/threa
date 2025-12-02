-- Memo reinforcements: Track each time a memo is reinforced by similar content
-- This enables recency-weighted strength and better deduplication

-- Reinforcements table
CREATE TABLE IF NOT EXISTS memo_reinforcements (
  id TEXT PRIMARY KEY DEFAULT 'reinf_' || replace(gen_random_uuid()::text, '-', ''),
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES stream_events(id) ON DELETE CASCADE,

  -- Reinforcement metadata
  reinforcement_type TEXT NOT NULL DEFAULT 'merge',  -- 'original' | 'merge' | 'thread_update'
  similarity_score REAL,                              -- How similar was this to existing content
  llm_verified BOOLEAN DEFAULT FALSE,                 -- Was this verified by LLM?

  -- Recency tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  weight REAL DEFAULT 1.0,                            -- Can decay over time

  UNIQUE(memo_id, event_id)
);

-- Index for finding reinforcements by memo
CREATE INDEX IF NOT EXISTS idx_memo_reinforcements_memo_id
  ON memo_reinforcements(memo_id);

-- Index for finding reinforcements by event (to check if event already reinforces something)
CREATE INDEX IF NOT EXISTS idx_memo_reinforcements_event_id
  ON memo_reinforcements(event_id);

-- Add reinforcement tracking columns to memos table
ALTER TABLE memos ADD COLUMN IF NOT EXISTS reinforcement_count INTEGER DEFAULT 1;
ALTER TABLE memos ADD COLUMN IF NOT EXISTS last_reinforced_at TIMESTAMPTZ;

-- Backfill: Create 'original' reinforcement records for existing anchor events
INSERT INTO memo_reinforcements (memo_id, event_id, reinforcement_type, similarity_score, created_at)
SELECT
  m.id as memo_id,
  unnest(m.anchor_event_ids) as event_id,
  'original' as reinforcement_type,
  1.0 as similarity_score,
  m.created_at as created_at
FROM memos m
WHERE m.archived_at IS NULL
  AND array_length(m.anchor_event_ids, 1) > 0
ON CONFLICT (memo_id, event_id) DO NOTHING;

-- Update reinforcement counts based on backfill
UPDATE memos m
SET reinforcement_count = (
  SELECT COUNT(*) FROM memo_reinforcements r WHERE r.memo_id = m.id
),
last_reinforced_at = (
  SELECT MAX(created_at) FROM memo_reinforcements r WHERE r.memo_id = m.id
)
WHERE archived_at IS NULL;

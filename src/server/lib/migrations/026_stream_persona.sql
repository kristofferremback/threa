-- ============================================================================
-- Add persona_id to streams for thinking spaces
-- ============================================================================
-- Allows thinking spaces to be associated with a specific AI persona

ALTER TABLE streams ADD COLUMN IF NOT EXISTS persona_id TEXT;

CREATE INDEX IF NOT EXISTS idx_streams_persona ON streams(persona_id) WHERE persona_id IS NOT NULL;

COMMENT ON COLUMN streams.persona_id IS 'For thinking_space: the AI persona that responds automatically in this space';

-- =============================================================================
-- Update Ariadne default model to Claude Sonnet 4.6
-- =============================================================================

-- Update column default
ALTER TABLE personas
ALTER COLUMN model SET DEFAULT 'openrouter:anthropic/claude-sonnet-4.6';

-- Update existing Ariadne persona
UPDATE personas
SET model = 'openrouter:anthropic/claude-sonnet-4.6'
WHERE id = 'persona_system_ariadne';

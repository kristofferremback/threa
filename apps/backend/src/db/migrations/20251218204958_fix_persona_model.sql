-- =============================================================================
-- Fix persona model to use OpenRouter instead of Anthropic direct
-- =============================================================================

-- Update column default
ALTER TABLE personas
ALTER COLUMN model SET DEFAULT 'openrouter:anthropic/claude-haiku-4.5';

-- Update existing Ariadne persona
UPDATE personas
SET model = 'openrouter:anthropic/claude-haiku-4.5'
WHERE id = 'persona_system_ariadne';

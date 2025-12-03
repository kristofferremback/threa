-- Add persona info to agent_sessions for displaying correct agent name/avatar in UI

-- Add persona tracking columns
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS persona_id TEXT REFERENCES agent_personas(id) ON DELETE SET NULL;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS persona_name TEXT;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS persona_avatar TEXT;

-- Default existing sessions to Ariadne
UPDATE agent_sessions
SET persona_name = 'Ariadne',
    persona_avatar = NULL
WHERE persona_name IS NULL;

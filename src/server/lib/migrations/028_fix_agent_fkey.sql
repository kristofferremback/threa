-- Fix stream_events.agent_id foreign key to reference agent_personas instead of ai_personas
-- The old ai_personas table from migration 012 has been superseded by agent_personas from migration 025

-- First, drop the existing foreign key constraint
ALTER TABLE stream_events DROP CONSTRAINT IF EXISTS stream_events_agent_id_fkey;

-- Delete events with orphaned agent_id where actor_id is also NULL
-- (these would violate chk_actor_or_agent constraint after clearing agent_id)
DELETE FROM stream_events
WHERE agent_id IS NOT NULL
  AND agent_id NOT IN (SELECT id FROM agent_personas)
  AND actor_id IS NULL;

-- Clear remaining orphaned agent_id references (where actor_id exists)
-- This handles old ai_personas references like 'pers_default_ariadne'
UPDATE stream_events
SET agent_id = NULL
WHERE agent_id IS NOT NULL
  AND agent_id NOT IN (SELECT id FROM agent_personas);

-- Add new foreign key referencing agent_personas
ALTER TABLE stream_events
  ADD CONSTRAINT stream_events_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agent_personas(id) ON DELETE SET NULL;

-- Also update streams.persona_id if it exists and has wrong reference
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_persona_id_fkey;

-- Clear orphaned persona_id references in streams that don't exist in agent_personas
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'streams' AND column_name = 'persona_id') THEN
    UPDATE streams
    SET persona_id = NULL
    WHERE persona_id IS NOT NULL
      AND persona_id NOT IN (SELECT id FROM agent_personas);

    ALTER TABLE streams
      ADD CONSTRAINT streams_persona_id_fkey
      FOREIGN KEY (persona_id) REFERENCES agent_personas(id) ON DELETE SET NULL;
  END IF;
END
$$;

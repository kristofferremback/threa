-- Add context_message_ids to agent_sessions
-- Tracks which message IDs were in the agent's context window at session creation.
-- Used to scope edit-triggered reruns to messages the agent actually saw,
-- preventing false triggers from edits to old messages outside the context window.

ALTER TABLE agent_sessions
ADD COLUMN IF NOT EXISTS context_message_ids TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from the CONTEXT_RECEIVED step's JSON content for existing sessions.
-- The step stores a subset of context messages (up to 5 around the trigger),
-- but the full conversation history (up to 20) is what the agent actually saw.
-- We extract what we have from the trace step as a best-effort backfill.
UPDATE agent_sessions AS s
SET context_message_ids = sub.ids
FROM (
  SELECT
    st.session_id,
    ARRAY(
      SELECT jsonb_array_elements_text(
        jsonb_path_query_array(st.content::jsonb, '$.messages[*].messageId')
      )
    ) AS ids
  FROM agent_session_steps st
  WHERE st.step_type = 'context_received'
    AND st.content IS NOT NULL
    AND st.content::text != ''
) sub
WHERE s.id = sub.session_id
  AND s.context_message_ids = '{}';

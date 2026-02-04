-- Add attachment tools to the Ariadne system persona
-- These tools enable multi-modal support: searching, viewing, and loading attachments

UPDATE personas
SET enabled_tools = enabled_tools || ARRAY['search_attachments', 'get_attachment', 'load_attachment']
WHERE id = 'persona_system_ariadne'
  AND NOT (enabled_tools @> ARRAY['search_attachments']);

-- Enable workspace search tools for Ariadne
-- These tools allow the agent to search and browse the user's workspace
UPDATE personas
SET enabled_tools = ARRAY[
  'send_message',
  'web_search',
  'read_url',
  'search_messages',
  'search_streams',
  'search_users',
  'get_stream_messages'
]
WHERE id = 'persona_system_ariadne';

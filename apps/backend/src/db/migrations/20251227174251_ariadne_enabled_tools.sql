-- Enable web search and read URL tools for the Ariadne system persona
UPDATE personas
SET enabled_tools = ARRAY['send_message', 'web_search', 'read_url']
WHERE id = 'persona_system_ariadne';

-- Add explicit chat_url to cerebras health_check config for generic HTTP provider
UPDATE providers
SET health_check = '{"url":"https://api.cerebras.ai/v1/models","auth_env":"CEREBRAS_API_KEY","chat_url":"https://api.cerebras.ai/v1/chat/completions"}'
WHERE name = 'cerebras' AND type = 'http';

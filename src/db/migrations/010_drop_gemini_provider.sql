-- Gemini CLI stopped serving personal Google plans on 2026-06-18; the provider was removed.
DELETE FROM models WHERE provider_name = 'gemini';
DELETE FROM providers WHERE name = 'gemini';

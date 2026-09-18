-- The generic HTTP provider type was removed; SheLLM only drives CLI subprocesses.
DELETE FROM models WHERE provider_name IN (SELECT name FROM providers WHERE type = 'http');
DELETE FROM providers WHERE type = 'http';

-- Usage per key was matched by name, so deleting a key and creating another with the same name
-- handed the old one's history to the new one.
ALTER TABLE request_logs ADD COLUMN client_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_logs_client_id ON request_logs(client_id);

-- One-off attribution of the rows written before the column existed. It credits a name to the key
-- that holds it today, which is the best the stored data supports; anything recycled before this
-- point cannot be told apart. From here on the id is what counts.
UPDATE request_logs
SET client_id = (SELECT id FROM clients WHERE clients.name = request_logs.client_name)
WHERE client_id IS NULL AND client_name IS NOT NULL;

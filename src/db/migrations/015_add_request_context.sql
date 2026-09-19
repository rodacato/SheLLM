-- What a failed request was: without these a logged 400 cannot say which route was asked for or
-- what was wrong with it, which is most of what debugging a 4xx needs. The path never carries the
-- query string, so a key passed as a parameter is not persisted here.
ALTER TABLE request_logs ADD COLUMN method TEXT;
ALTER TABLE request_logs ADD COLUMN path TEXT;
ALTER TABLE request_logs ADD COLUMN error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_error ON request_logs(error_code);

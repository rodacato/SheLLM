-- Metrics the CLI already reports and the logs discarded: the cache token counters that make
-- `tokens` match `cost_usd`, the latency layers, and the model that actually ran.
ALTER TABLE request_logs ADD COLUMN tokens_in INTEGER;
ALTER TABLE request_logs ADD COLUMN tokens_out INTEGER;
ALTER TABLE request_logs ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE request_logs ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE request_logs ADD COLUMN ttft_ms INTEGER;
ALTER TABLE request_logs ADD COLUMN api_ms INTEGER;
ALTER TABLE request_logs ADD COLUMN upstream_model TEXT;
ALTER TABLE request_logs ADD COLUMN streamed INTEGER;
ALTER TABLE request_logs ADD COLUMN api_error_status INTEGER;

CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(upstream_model);

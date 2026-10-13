-- What a request would have cost at API list price, for a CLI that reports no cost (ADR-0012).
-- Kept apart from cost_usd, which stays the figure a CLI reported.
ALTER TABLE request_logs ADD COLUMN cost_estimate_usd REAL;

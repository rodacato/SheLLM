-- Monthly cap on a key's API-equivalent cost, reported plus estimated (ADR-0013). NULL = no cap.
ALTER TABLE clients ADD COLUMN spend_limit_usd REAL;

-- Every key starts with shellm-, so the 8-character prefix alone carries one random character.
-- NULL for keys created before this: their end was never stored and cannot be derived.
ALTER TABLE clients ADD COLUMN key_suffix TEXT;

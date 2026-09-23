-- A key handed to a browser app is scoped to the pages allowed to use it. NULL is no restriction,
-- which is what every key that existed before this column keeps.
ALTER TABLE clients ADD COLUMN origins TEXT;

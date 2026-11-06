ALTER TABLE matches ADD COLUMN IF NOT EXISTS public_id TEXT;
UPDATE matches SET public_id = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 16) WHERE public_id IS NULL;
ALTER TABLE matches ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE matches ADD CONSTRAINT matches_public_id_unique UNIQUE (public_id);

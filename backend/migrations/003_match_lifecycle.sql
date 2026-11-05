-- Forward-compatible schema updates for match lifecycle and scoring.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS submissions_match_score_idx ON submissions(match_id, created_at, id) WHERE verdict='OK';

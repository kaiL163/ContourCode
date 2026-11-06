-- Preserve the source contest for old matches, but copy the task set into each match.
ALTER TABLE matches ALTER COLUMN contest_id DROP NOT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
UPDATE matches m SET duration_minutes = c.duration_minutes FROM contests c WHERE m.contest_id = c.id AND m.duration_minutes IS NULL;
ALTER TABLE matches ALTER COLUMN duration_minutes SET NOT NULL;
ALTER TABLE matches ADD CONSTRAINT matches_duration_positive CHECK (duration_minutes > 0);
CREATE TABLE IF NOT EXISTS match_tasks (
    match_id BIGINT NOT NULL REFERENCES matches ON DELETE CASCADE,
    task_id BIGINT NOT NULL REFERENCES tasks,
    position INTEGER NOT NULL,
    PRIMARY KEY (match_id, task_id),
    UNIQUE (match_id, position)
);
INSERT INTO match_tasks (match_id, task_id, position)
SELECT m.id, ct.task_id, row_number() OVER (PARTITION BY m.id ORDER BY ct.task_id)
FROM matches m JOIN contest_tasks ct ON ct.contest_id = m.contest_id
ON CONFLICT DO NOTHING;
ALTER TABLE submissions ALTER COLUMN contest_id DROP NOT NULL;
UPDATE submissions SET contest_id = NULL WHERE match_id IS NOT NULL;
ALTER TABLE submissions ADD CONSTRAINT submission_one_competition CHECK ((contest_id IS NOT NULL) <> (match_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS submissions_contest_idx ON submissions (contest_id, user_id, created_at) WHERE contest_id IS NOT NULL;

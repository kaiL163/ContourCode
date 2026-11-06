CREATE TABLE IF NOT EXISTS match_drafts (
    match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    source_code TEXT NOT NULL DEFAULT '',
    updated_by BIGINT NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, task_id)
);

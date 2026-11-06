-- Append-only snapshots of solution source written in the contest editor.
-- Versions are informational. Change volume and speed are not a verdict.

CREATE TABLE IF NOT EXISTS code_versions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users ON DELETE CASCADE,
    contest_id BIGINT REFERENCES contests ON DELETE CASCADE,
    match_id BIGINT REFERENCES matches ON DELETE CASCADE,
    task_id BIGINT NOT NULL REFERENCES tasks,
    session_id UUID NOT NULL,
    submission_id BIGINT UNIQUE REFERENCES submissions ON DELETE SET NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    code_content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('INITIAL', 'AUTOSAVE', 'MANUAL_SAVE', 'SUBMISSION')),
    added_lines INTEGER NOT NULL DEFAULT 0 CHECK (added_lines >= 0),
    removed_lines INTEGER NOT NULL DEFAULT 0 CHECK (removed_lines >= 0),
    client_request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT code_versions_one_scope CHECK ((contest_id IS NOT NULL) <> (match_id IS NOT NULL)),
    CONSTRAINT code_versions_submission_type CHECK (
        (change_type = 'SUBMISSION') = (submission_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS code_versions_contest_number_idx
    ON code_versions (user_id, contest_id, task_id, version_number)
    WHERE contest_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS code_versions_match_number_idx
    ON code_versions (user_id, match_id, task_id, version_number)
    WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS code_versions_request_idx
    ON code_versions (user_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS code_versions_contest_created_idx
    ON code_versions (user_id, contest_id, task_id, created_at DESC)
    WHERE contest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS code_versions_match_created_idx
    ON code_versions (user_id, match_id, task_id, created_at DESC)
    WHERE match_id IS NOT NULL;

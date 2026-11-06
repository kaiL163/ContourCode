CREATE TABLE IF NOT EXISTS match_finish_ready (
    match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    PRIMARY KEY (match_id, user_id)
);

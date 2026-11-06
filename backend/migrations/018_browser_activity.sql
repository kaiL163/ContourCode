-- Browser activity monitoring for contest participants.
-- Events are informational signals for organizers, not proof of a violation.
-- Default retention: 90 days (enforced by the API on ingest and explicit purge).

CREATE TABLE IF NOT EXISTS browser_activity_sessions (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users ON DELETE CASCADE,
    contest_id BIGINT NOT NULL REFERENCES contests ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS browser_activity_sessions_open_idx
    ON browser_activity_sessions (contest_id, user_id)
    WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS browser_activity_events (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users ON DELETE CASCADE,
    contest_id BIGINT NOT NULL REFERENCES contests ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES browser_activity_sessions ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'TAB_HIDDEN',
        'TAB_VISIBLE',
        'WINDOW_BLUR',
        'WINDOW_FOCUS',
        'FULLSCREEN_EXIT',
        'FULLSCREEN_ENTER',
        'PAGE_EXIT',
        'CONTEXT_MENU',
        'COPY',
        'PASTE'
    )),
    occurred_at TIMESTAMPTZ NOT NULL,
    client_timestamp TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS browser_activity_events_contest_user_idx
    ON browser_activity_events (contest_id, user_id, occurred_at, id);

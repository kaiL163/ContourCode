from datetime import datetime, timedelta, timezone
from uuid import uuid4

from backend.app.browser_activity import compute_participant_stats, sanitize_metadata


def _event(kind, seconds, extra=None):
    base = datetime(2026, 11, 7, 10, 0, tzinfo=timezone.utc)
    return {
        "id": seconds,
        "event_id": uuid4(),
        "event_type": kind,
        "occurred_at": base + timedelta(seconds=seconds),
        "metadata": extra or {},
    }


def test_hidden_and_blur_durations_are_not_double_counted():
    events = [
        _event("WINDOW_BLUR", 0),
        _event("TAB_HIDDEN", 1),
        _event("TAB_VISIBLE", 11),
        _event("WINDOW_FOCUS", 12),
        _event("COPY", 13),
        _event("PASTE", 14),
        _event("FULLSCREEN_EXIT", 15),
    ]
    stats = compute_participant_stats(events)
    assert stats["tab_switches"] == 1
    assert stats["tab_hidden_ms"] == 10_000
    assert stats["window_blurs"] == 1
    assert stats["window_blur_ms"] == 2_000
    assert stats["copy_count"] == 1
    assert stats["paste_count"] == 1
    assert stats["fullscreen_exits"] == 1
    assert stats["tab_hidden_unknown_intervals"] == 0


def test_metadata_keeps_only_technical_fields():
    assert sanitize_metadata(
        {
            "visibility_state": "hidden",
            "clipboard": "secret",
            "other_tab": "mail",
            "source": "visibilitychange",
        }
    ) == {"visibility_state": "hidden", "source": "visibilitychange"}


def test_open_interval_is_marked_unknown():
    stats = compute_participant_stats([_event("TAB_HIDDEN", 0)])
    assert stats["tab_hidden_ms"] == 0
    assert stats["tab_hidden_unknown_intervals"] == 1
    assert stats["hidden_intervals"][0]["duration_unknown"] is True
    assert stats["hidden_intervals"][0]["duration_ms"] is None


def test_activity_api_auth_and_batch():
    from fastapi.testclient import TestClient
    from backend.app.main import app

    with TestClient(app) as client:
        tokens = {}
        for username in ("demo-organizer", "demo-participant-1", "demo-participant-2"):
            login = client.post(
                "/api/auth/login", json={"username": username, "password": "demo123"}
            )
            assert login.status_code == 200
            tokens[username] = login.json()["access_token"]
        organizer = {"Authorization": f"Bearer {tokens['demo-organizer']}"}
        p1 = {"Authorization": f"Bearer {tokens['demo-participant-1']}"}
        p2 = {"Authorization": f"Bearer {tokens['demo-participant-2']}"}
        contests = client.get("/api/contests", headers=p1).json()
        contest = next(c for c in contests if c["title"] == "Алгоритмический раунд")
        cid = contest["id"]

        assert (
            client.post(
                f"/api/contests/{cid}/browser-activity/session", headers=organizer
            ).status_code
            == 403
        )
        opened = client.post(
            f"/api/contests/{cid}/browser-activity/session", headers=p1
        )
        assert opened.status_code == 200
        session_id = opened.json()["session_id"]
        assert opened.json()["policy"]["retention_days"] == 90

        event_id = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "session_id": session_id,
            "events": [
                {
                    "event_id": event_id,
                    "event_type": "TAB_HIDDEN",
                    "client_timestamp": now,
                    "metadata": {"visibility_state": "hidden", "clipboard": "secret"},
                }
            ],
        }
        first = client.post(
            f"/api/contests/{cid}/browser-activity/events", headers=p1, json=payload
        )
        assert first.status_code == 200 and first.json()["accepted"] == 1
        again = client.post(
            f"/api/contests/{cid}/browser-activity/events", headers=p1, json=payload
        )
        assert again.status_code == 200 and again.json()["duplicates"] == 1

        foreign = client.post(
            f"/api/contests/{cid}/browser-activity/events",
            headers=p2,
            json=payload,
        )
        assert foreign.status_code == 403

        bad_type = client.post(
            f"/api/contests/{cid}/browser-activity/events",
            headers=p1,
            json={
                "session_id": session_id,
                "events": [
                    {
                        "event_id": str(uuid4()),
                        "event_type": "KEYLOGGER",
                        "client_timestamp": now,
                        "metadata": {},
                    }
                ],
            },
        )
        assert bad_type.status_code == 422

        too_big = client.post(
            f"/api/contests/{cid}/browser-activity/events",
            headers=p1,
            json={
                "session_id": session_id,
                "events": [
                    {
                        "event_id": str(uuid4()),
                        "event_type": "CONTEXT_MENU",
                        "client_timestamp": now,
                        "metadata": {},
                    }
                    for _ in range(51)
                ],
            },
        )
        assert too_big.status_code == 422

        assert (
            client.get(
                f"/api/contests/{cid}/browser-activity/summary", headers=p1
            ).status_code
            == 403
        )
        summary = client.get(
            f"/api/contests/{cid}/browser-activity/summary", headers=organizer
        )
        assert summary.status_code == 200
        body = summary.json()
        assert body["participant_count"] >= 2
        assert body["event_count"] >= 1
        table = client.get(
            f"/api/contests/{cid}/browser-activity/participants?sort=tab_switches&order=desc",
            headers=organizer,
        )
        assert table.status_code == 200
        row = next(r for r in table.json()["rows"] if r["tab_switches"] >= 1)
        detail = client.get(
            f"/api/contests/{cid}/browser-activity/participants/{row['user_id']}",
            headers=organizer,
        )
        assert detail.status_code == 200
        assert detail.json()["events"][0]["event_type"] == "TAB_HIDDEN"
        stored_meta = client.get(
            f"/api/contests/{cid}/browser-activity/participants/{row['user_id']}",
            headers=organizer,
        ).json()
        assert "clipboard" not in str(stored_meta)

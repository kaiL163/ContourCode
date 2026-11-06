from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.app.code_history import (
    build_diff,
    content_hash,
    summarize_versions,
    _require_scope,
)


def test_content_hash_changes_only_when_text_changes():
    assert content_hash("int main(){return 0;}") == content_hash("int main(){return 0;}")
    assert content_hash("a") != content_hash("b")


def test_diff_reports_added_removed_and_changed_lines():
    diff = build_diff("alpha\nkeep\n", "alpha\nchanged\nextra\n")
    assert diff["removed_lines"] == 1
    assert diff["added_lines"] == 2
    assert diff["changed_lines"] == 1
    kinds = [row["kind"] for row in diff["rows"]]
    assert kinds == ["same", "changed", "added"]
    assert "keep" in diff["unified"]
    assert diff["rows"][1]["left"] == "keep"
    assert diff["rows"][1]["right"] == "changed"


def test_identical_code_has_no_line_changes():
    diff = build_diff("same\n", "same\n")
    assert diff["added_lines"] == 0
    assert diff["removed_lines"] == 0
    assert diff["changed_lines"] == 0
    assert [row["kind"] for row in diff["rows"]] == ["same"]


def test_summary_counts_versions_gaps_and_does_not_judge():
    start = datetime(2026, 11, 7, 14, 2, tzinfo=timezone.utc)
    rows = [
        {"id": 1, "version_number": 1, "created_at": start, "added_lines": 0, "removed_lines": 0},
        {
            "id": 2,
            "version_number": 2,
            "created_at": start + timedelta(minutes=3),
            "added_lines": 4,
            "removed_lines": 1,
        },
        {
            "id": 3,
            "version_number": 3,
            "created_at": start + timedelta(minutes=13),
            "added_lines": 2,
            "removed_lines": 2,
        },
    ]
    summary = summarize_versions(rows, {"added_lines": 5, "removed_lines": 1, "changed_lines": 1})
    assert summary["version_count"] == 3
    assert summary["change_count"] == 2
    assert summary["added_lines"] == 6
    assert summary["removed_lines"] == 3
    assert summary["duration_seconds"] == 13 * 60
    assert summary["gaps_seconds"] == [180, 600]
    assert "не означают нарушение" in summary["disclaimer"]
    assert "плагиат" not in summary["disclaimer"].casefold()


def test_scope_requires_exactly_one_competition():
    with pytest.raises(HTTPException):
        _require_scope(None, None)
    with pytest.raises(HTTPException):
        _require_scope(1, 2)
    _require_scope(1, None)
    _require_scope(None, 2)


def _client_or_skip():
    from fastapi.testclient import TestClient
    from backend.app.main import app

    try:
        client = TestClient(app)
        client.__enter__()
    except Exception as exc:
        pytest.skip(f"database unavailable: {exc}")
    probe = client.post(
        "/api/auth/login",
        json={"username": "demo-organizer", "password": "demo123"},
    )
    if probe.status_code == 503:
        client.__exit__(None, None, None)
        pytest.skip("database unavailable")
    return client


def _scenario(client):
    tokens = {}
    for username in ("demo-organizer", "demo-participant-1", "demo-participant-2"):
        login = client.post(
            "/api/auth/login", json={"username": username, "password": "demo123"}
        )
        assert login.status_code == 200
        tokens[username] = login.json()["access_token"]
    organizer = {"Authorization": f"Bearer {tokens['demo-organizer']}"}
    participant = {"Authorization": f"Bearer {tokens['demo-participant-1']}"}
    other = {"Authorization": f"Bearer {tokens['demo-participant-2']}"}
    created = client.post(
        "/api/tasks",
        headers=organizer,
        json={
            "title": f"История {uuid4()}",
            "statement": "Выведите число.",
            "time_limit_ms": 1000,
            "memory_limit_kb": 65536,
            "difficulty": "easy",
            "tests": [{"input": "1", "output": "1"}],
        },
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    outsider = client.post(
        "/api/tasks",
        headers=organizer,
        json={
            "title": f"Чужая {uuid4()}",
            "statement": "Другая задача.",
            "time_limit_ms": 1000,
            "memory_limit_kb": 65536,
            "difficulty": "easy",
            "tests": [{"input": "1", "output": "1"}],
        },
    )
    assert outsider.status_code == 201
    contest = client.post(
        "/api/contests",
        headers=organizer,
        json={
            "title": f"История кода {uuid4()}",
            "description": "Проверка истории",
            "starts_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
            "duration_minutes": 1000,
            "task_ids": [task_id],
        },
    )
    assert contest.status_code == 201
    contest_id = contest.json()["id"]
    assert client.post(f"/api/contests/{contest_id}/register", headers=participant).status_code == 201
    assert client.post(f"/api/contests/{contest_id}/register", headers=other).status_code == 201
    return organizer, participant, other, contest_id, task_id, outsider.json()["id"]


def _save(client, headers, contest_id, task_id, code, change_type="AUTOSAVE", request_id=None, session_id=None):
    return client.post(
        "/api/code-history/versions",
        headers=headers,
        json={
            "contest_id": contest_id,
            "task_id": task_id,
            "session_id": session_id or str(uuid4()),
            "code_content": code,
            "change_type": change_type,
            "client_request_id": request_id or str(uuid4()),
        },
    )


def test_versions_numbering_dedup_diff_submission_and_access(monkeypatch):
    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr("backend.app.main._check_submission", _noop)
    client = _client_or_skip()
    try:
        organizer, participant, other, contest_id, task_id, foreign_task = _scenario(client)
        session_id = str(uuid4())
        initial = _save(client, participant, contest_id, task_id, "one\n", "INITIAL", session_id=session_id)
        assert initial.status_code == 200
        assert initial.json()["created"] is True
        assert initial.json()["version_number"] == 1
        assert initial.json()["change_type"] == "INITIAL"

        again = _save(client, participant, contest_id, task_id, "one\n", "AUTOSAVE", session_id=session_id)
        assert again.status_code == 200
        assert again.json()["created"] is False
        assert again.json()["id"] == initial.json()["id"]

        request_id = str(uuid4())
        second = _save(
            client, participant, contest_id, task_id, "one\ntwo\n", "MANUAL_SAVE", request_id, session_id
        )
        assert second.status_code == 200
        assert second.json()["created"] is True
        assert second.json()["version_number"] == 2
        replay = _save(
            client,
            participant,
            contest_id,
            task_id,
            "entirely different\n",
            "MANUAL_SAVE",
            request_id,
            session_id,
        )
        assert replay.status_code == 200
        assert replay.json()["created"] is False
        assert replay.json()["id"] == second.json()["id"]
        assert replay.json()["content_hash"] == second.json()["content_hash"]

        stored = client.get(f"/api/code-history/versions/{initial.json()['id']}", headers=participant)
        assert stored.status_code == 200
        assert stored.json()["code_content"] == "one\n"

        diff = client.get(
            f"/api/code-history/versions/{initial.json()['id']}/diff/{second.json()['id']}",
            headers=participant,
        )
        assert diff.status_code == 200
        body = diff.json()
        assert body["added_lines"] == 1
        assert body["from_version_number"] == 1
        assert body["to_version_number"] == 2

        assert client.put(
            f"/api/code-history/versions/{initial.json()['id']}",
            headers=participant,
            json={"code_content": "mutated"},
        ).status_code == 405

        sent = client.post(
            "/api/submissions",
            headers=participant,
            json={
                "contest_id": contest_id,
                "task_id": task_id,
                "source_code": "one\ntwo\n",
                "session_id": session_id,
            },
        )
        assert sent.status_code == 202
        linked = client.get(
            f"/api/code-history/submissions/{sent.json()['id']}",
            headers=participant,
        )
        assert linked.status_code == 200
        assert linked.json()["change_type"] == "SUBMISSION"
        assert linked.json()["submission_id"] == sent.json()["id"]
        assert linked.json()["version_number"] == 3
        assert linked.json()["code_content"] == "one\ntwo\n"

        history = client.get(
            f"/api/code-history/tasks/{task_id}?contest_id={contest_id}&user_id={linked.json()['user_id']}",
            headers=organizer,
        )
        assert history.status_code == 200
        page = history.json()
        assert page["total"] == 3
        assert page["analytics"]["version_count"] == 3
        assert page["analytics"]["change_count"] == 2
        assert "не означают нарушение" in page["disclaimer"]
        assert "code_content" not in page["versions"][0]

        assert client.get(
            f"/api/code-history/tasks/{task_id}?contest_id={contest_id}&user_id={linked.json()['user_id']}",
            headers=other,
        ).status_code == 403
        assert client.get(
            f"/api/code-history/versions/{initial.json()['id']}",
            headers=other,
        ).status_code == 403
        assert client.get(
            f"/api/code-history/submissions/{sent.json()['id']}",
            headers=other,
        ).status_code == 403
        assert client.get(f"/api/code-history/versions/{initial.json()['id']}").status_code == 401
        assert _save(client, organizer, contest_id, task_id, "nope\n").status_code == 403
        assert _save(client, participant, contest_id, foreign_task, "nope\n").status_code == 403
        assert _save(client, participant, contest_id, task_id, "x" * 100_001).status_code == 422
        assert client.post(
            "/api/code-history/versions",
            headers=participant,
            json={
                "contest_id": contest_id,
                "task_id": task_id,
                "session_id": session_id,
                "code_content": "final\n",
                "change_type": "SUBMISSION",
                "client_request_id": str(uuid4()),
            },
        ).status_code == 422

        other_session = _save(client, participant, contest_id, task_id, "third\n", session_id=str(uuid4()))
        assert other_session.status_code == 200
        assert other_session.json()["version_number"] == 4
    finally:
        client.__exit__(None, None, None)

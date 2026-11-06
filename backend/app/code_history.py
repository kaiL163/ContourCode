"""Append-only editor history for a participant working on one task.

Snapshots describe what was in the editor. They are not a judgment about
how the solution was written.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import difflib
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

MAX_CODE_CHARS = 100_000
CHANGE_TYPES = ("INITIAL", "AUTOSAVE", "MANUAL_SAVE", "SUBMISSION")
CLIENT_CHANGE_TYPES = ("INITIAL", "AUTOSAVE", "MANUAL_SAVE")
DISCLAIMER = (
    "Показатели описывают сохранённые версии кода. "
    "Количество правок и скорость набора сами по себе не означают нарушение."
)


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contest_id: int | None = None
    match_id: int | None = None
    task_id: int
    session_id: UUID
    code_content: str = Field(max_length=MAX_CODE_CHARS)
    change_type: str
    client_request_id: UUID


def content_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _lines(code: str) -> list[str]:
    if code == "":
        return []
    return code.splitlines()


def build_diff(before: str, after: str) -> dict[str, Any]:
    """Line diff. A replaced span is reported as removed and added lines."""
    left = _lines(before)
    right = _lines(after)
    rows: list[dict[str, Any]] = []
    added = removed = changed = 0
    left_no = right_no = 1
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=left, b=right).get_opcodes():
        if tag == "equal":
            for offset, line in enumerate(left[i1:i2]):
                rows.append(
                    {
                        "kind": "same",
                        "left": line,
                        "right": right[j1 + offset],
                        "left_line": left_no + offset,
                        "right_line": right_no + offset,
                    }
                )
            left_no += i2 - i1
            right_no += j2 - j1
            continue
        left_span = left[i1:i2]
        right_span = right[j1:j2]
        if tag == "replace":
            paired = min(len(left_span), len(right_span))
            changed += paired
            removed += len(left_span)
            added += len(right_span)
            for offset in range(paired):
                rows.append(
                    {
                        "kind": "changed",
                        "left": left_span[offset],
                        "right": right_span[offset],
                        "left_line": left_no + offset,
                        "right_line": right_no + offset,
                    }
                )
            for offset, line in enumerate(left_span[paired:]):
                rows.append(
                    {
                        "kind": "removed",
                        "left": line,
                        "right": None,
                        "left_line": left_no + paired + offset,
                        "right_line": None,
                    }
                )
            for offset, line in enumerate(right_span[paired:]):
                rows.append(
                    {
                        "kind": "added",
                        "left": None,
                        "right": line,
                        "left_line": None,
                        "right_line": right_no + paired + offset,
                    }
                )
        elif tag == "delete":
            removed += len(left_span)
            for offset, line in enumerate(left_span):
                rows.append(
                    {
                        "kind": "removed",
                        "left": line,
                        "right": None,
                        "left_line": left_no + offset,
                        "right_line": None,
                    }
                )
        elif tag == "insert":
            added += len(right_span)
            for offset, line in enumerate(right_span):
                rows.append(
                    {
                        "kind": "added",
                        "left": None,
                        "right": line,
                        "left_line": None,
                        "right_line": right_no + offset,
                    }
                )
        left_no += len(left_span)
        right_no += len(right_span)
    unified = "\n".join(
        difflib.unified_diff(
            left,
            right,
            fromfile="before",
            tofile="after",
            lineterm="",
        )
    )
    return {
        "added_lines": added,
        "removed_lines": removed,
        "changed_lines": changed,
        "rows": rows,
        "unified": unified,
    }


def summarize_versions(rows: list[dict[str, Any]], first_to_last: dict[str, int]) -> dict[str, Any]:
    ordered = sorted(rows, key=lambda item: (item["version_number"], item["id"]))
    gaps: list[int] = []
    for previous, current in zip(ordered, ordered[1:]):
        gaps.append(
            max(
                0,
                int((current["created_at"] - previous["created_at"]).total_seconds()),
            )
        )
    if ordered:
        duration = max(
            0,
            int((ordered[-1]["created_at"] - ordered[0]["created_at"]).total_seconds()),
        )
    else:
        duration = 0
    midpoint = len(gaps) // 2
    if not gaps:
        median = 0
    elif len(gaps) % 2:
        median = sorted(gaps)[midpoint]
    else:
        ordered_gaps = sorted(gaps)
        median = int((ordered_gaps[midpoint - 1] + ordered_gaps[midpoint]) / 2)
    return {
        "version_count": len(ordered),
        "change_count": max(0, len(ordered) - 1),
        "added_lines": sum(item["added_lines"] for item in ordered),
        "removed_lines": sum(item["removed_lines"] for item in ordered),
        "duration_seconds": duration,
        "gaps_seconds": gaps,
        "median_gap_seconds": median,
        "first_to_last_added_lines": first_to_last["added_lines"],
        "first_to_last_removed_lines": first_to_last["removed_lines"],
        "first_to_last_changed_lines": first_to_last["changed_lines"],
        "disclaimer": DISCLAIMER,
    }


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _require_scope(contest_id: int | None, match_id: int | None) -> None:
    if (contest_id is None) == (match_id is None):
        raise HTTPException(422, "Укажите соревнование или матч")


def _scope_sql(contest_id: int | None, match_id: int | None) -> tuple[str, list[Any]]:
    if contest_id is not None:
        return "contest_id=%s AND match_id IS NULL", [contest_id]
    return "match_id=%s AND contest_id IS NULL", [match_id]


def _assert_task_in_scope(c, contest_id: int | None, match_id: int | None, task_id: int) -> None:
    if contest_id is not None:
        if not c.execute(
            "SELECT 1 FROM contest_tasks WHERE contest_id=%s AND task_id=%s",
            (contest_id, task_id),
        ).fetchone():
            raise HTTPException(403, "Задача не входит в соревнование")
        return
    if not c.execute(
        "SELECT 1 FROM match_tasks WHERE match_id=%s AND task_id=%s",
        (match_id, task_id),
    ).fetchone():
        raise HTTPException(403, "Задача не входит в матч")


def _assert_member(c, user_id: int, contest_id: int | None, match_id: int | None) -> None:
    if contest_id is not None:
        if not c.execute(
            "SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s",
            (contest_id, user_id),
        ).fetchone():
            raise HTTPException(403, "Требуется регистрация в соревновании")
        return
    match = c.execute(
        "SELECT participant_ids FROM matches WHERE id=%s",
        (match_id,),
    ).fetchone()
    if not match or user_id not in match[0]:
        raise HTTPException(403, "Нет доступа к матчу")


def _assert_writer(c, user: dict, contest_id: int | None, match_id: int | None, task_id: int) -> None:
    if user["role"] != "participant":
        raise HTTPException(403, "Сохранять историю может участник")
    _require_scope(contest_id, match_id)
    _assert_task_in_scope(c, contest_id, match_id, task_id)
    _assert_member(c, user["id"], contest_id, match_id)


def _assert_reader(
    c,
    user: dict,
    *,
    owner_id: int,
    contest_id: int | None,
    match_id: int | None,
) -> None:
    _require_scope(contest_id, match_id)
    if user["id"] == owner_id:
        _assert_member(c, user["id"], contest_id, match_id)
        return
    if contest_id is None or user["role"] != "organizer":
        raise HTTPException(403, "Нет доступа к истории кода")
    contest = c.execute(
        "SELECT organizer_id FROM contests WHERE id=%s",
        (contest_id,),
    ).fetchone()
    if not contest:
        raise HTTPException(404, "Соревнование не найдено")
    if contest[0] != user["id"]:
        raise HTTPException(403, "Нет доступа к истории кода")
    if not c.execute(
        "SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s",
        (contest_id, owner_id),
    ).fetchone():
        raise HTTPException(404, "Участник соревнования не найден")


def _lock_key(user_id: int, contest_id: int | None, match_id: int | None, task_id: int) -> str:
    return f"code-version:{user_id}:{contest_id or 0}:{match_id or 0}:{task_id}"


def _version_dict(row: tuple, *, include_code: bool) -> dict[str, Any]:
    item = {
        "id": row[0],
        "user_id": row[1],
        "contest_id": row[2],
        "match_id": row[3],
        "task_id": row[4],
        "session_id": str(row[5]),
        "submission_id": row[6],
        "version_number": row[7],
        "content_hash": row[8],
        "change_type": row[9],
        "added_lines": row[10],
        "removed_lines": row[11],
        "code_size": row[12],
        "created_at": _aware(row[13]),
    }
    if include_code:
        item["code_content"] = row[14]
    return item


_COLUMNS = """
id, user_id, contest_id, match_id, task_id, session_id, submission_id,
version_number, content_hash, change_type, added_lines, removed_lines,
char_length(code_content), created_at, code_content
"""


def _fetch_by_request(c, user_id: int, request_id: UUID) -> dict[str, Any] | None:
    row = c.execute(
        f"SELECT {_COLUMNS} FROM code_versions WHERE user_id=%s AND client_request_id=%s",
        (user_id, request_id),
    ).fetchone()
    return _version_dict(row, include_code=False) if row else None


def _latest(c, user_id: int, contest_id: int | None, match_id: int | None, task_id: int):
    scope_sql, scope_args = _scope_sql(contest_id, match_id)
    return c.execute(
        f"""
        SELECT version_number, content_hash, code_content
        FROM code_versions
        WHERE user_id=%s AND task_id=%s AND {scope_sql}
        ORDER BY version_number DESC
        LIMIT 1
        """,
        (user_id, task_id, *scope_args),
    ).fetchone()


def save_version(
    c,
    *,
    user_id: int,
    contest_id: int | None,
    match_id: int | None,
    task_id: int,
    session_id: UUID,
    code_content: str,
    change_type: str,
    client_request_id: UUID | None,
    submission_id: int | None,
) -> tuple[dict[str, Any], bool]:
    if change_type not in CHANGE_TYPES:
        raise HTTPException(422, "Неизвестный тип изменения")
    if len(code_content) > MAX_CODE_CHARS:
        raise HTTPException(422, "Исходный код слишком большой")
    if (change_type == "SUBMISSION") != (submission_id is not None):
        raise HTTPException(422, "Версия отправки должна быть связана с отправкой")
    _require_scope(contest_id, match_id)
    if client_request_id is not None:
        existing = _fetch_by_request(c, user_id, client_request_id)
        if existing:
            return existing, False
    c.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
        (_lock_key(user_id, contest_id, match_id, task_id),),
    )
    if client_request_id is not None:
        existing = _fetch_by_request(c, user_id, client_request_id)
        if existing:
            return existing, False
    latest = _latest(c, user_id, contest_id, match_id, task_id)
    digest = content_hash(code_content)
    if latest and change_type != "SUBMISSION" and latest[1] == digest:
        scope_sql, scope_args = _scope_sql(contest_id, match_id)
        row = c.execute(
            f"""
            SELECT {_COLUMNS} FROM code_versions
            WHERE user_id=%s AND task_id=%s AND version_number=%s AND {scope_sql}
            """,
            (user_id, task_id, latest[0], *scope_args),
        ).fetchone()
        return _version_dict(row, include_code=False), False
    previous = latest[2] if latest else ""
    step = build_diff(previous, code_content) if latest else {
        "added_lines": 0,
        "removed_lines": 0,
    }
    number = (latest[0] if latest else 0) + 1
    row = c.execute(
        f"""
        INSERT INTO code_versions(
            user_id, contest_id, match_id, task_id, session_id, submission_id,
            version_number, code_content, content_hash, change_type,
            added_lines, removed_lines, client_request_id
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING {_COLUMNS}
        """,
        (
            user_id,
            contest_id,
            match_id,
            task_id,
            session_id,
            submission_id,
            number,
            code_content,
            digest,
            change_type,
            step["added_lines"],
            step["removed_lines"],
            client_request_id,
        ),
    ).fetchone()
    return _version_dict(row, include_code=False), True


def record_submission_version(
    c,
    *,
    user_id: int,
    contest_id: int | None,
    match_id: int | None,
    task_id: int,
    session_id: str | None,
    submission_id: int,
    code_content: str,
) -> dict[str, Any]:
    parsed: UUID
    if session_id:
        try:
            parsed = UUID(session_id)
        except ValueError as exc:
            raise HTTPException(422, "Некорректный session_id") from exc
    else:
        parsed = uuid4()
    version, _created = save_version(
        c,
        user_id=user_id,
        contest_id=contest_id,
        match_id=match_id,
        task_id=task_id,
        session_id=parsed,
        code_content=code_content,
        change_type="SUBMISSION",
        client_request_id=None,
        submission_id=submission_id,
    )
    return version


def _load_version(c, version_id: int) -> dict[str, Any]:
    row = c.execute(
        f"SELECT {_COLUMNS} FROM code_versions WHERE id=%s",
        (version_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Версия не найдена")
    return _version_dict(row, include_code=True)


def list_history(
    c,
    *,
    user_id: int,
    contest_id: int | None,
    match_id: int | None,
    task_id: int,
    limit: int,
    offset: int,
    include_latest_code: bool,
) -> dict[str, Any]:
    _require_scope(contest_id, match_id)
    _assert_task_in_scope(c, contest_id, match_id, task_id)
    scope_sql, scope_args = _scope_sql(contest_id, match_id)
    where = f"user_id=%s AND task_id=%s AND {scope_sql}"
    args = [user_id, task_id, *scope_args]
    total = c.execute(
        f"SELECT COUNT(*) FROM code_versions WHERE {where}",
        args,
    ).fetchone()[0]
    rows = c.execute(
        f"""
        SELECT id, version_number, change_type, created_at, added_lines, removed_lines,
               char_length(code_content), content_hash, session_id, submission_id,
               contest_id, match_id, task_id, user_id
        FROM code_versions
        WHERE {where}
        ORDER BY version_number DESC
        LIMIT %s OFFSET %s
        """,
        [*args, limit, offset],
    ).fetchall()
    versions = [
        {
            "id": row[0],
            "version_number": row[1],
            "change_type": row[2],
            "created_at": _aware(row[3]),
            "added_lines": row[4],
            "removed_lines": row[5],
            "code_size": row[6],
            "content_hash": row[7],
            "session_id": str(row[8]),
            "submission_id": row[9],
            "contest_id": row[10],
            "match_id": row[11],
            "task_id": row[12],
            "user_id": row[13],
        }
        for row in rows
    ]
    meta = c.execute(
        f"""
        SELECT id, version_number, change_type, created_at, added_lines, removed_lines
        FROM code_versions
        WHERE {where}
        ORDER BY version_number ASC
        """,
        args,
    ).fetchall()
    summary_rows = [
        {
            "id": row[0],
            "version_number": row[1],
            "change_type": row[2],
            "created_at": _aware(row[3]),
            "added_lines": row[4],
            "removed_lines": row[5],
        }
        for row in meta
    ]
    if len(summary_rows) >= 2:
        ends = c.execute(
            f"""
            SELECT code_content FROM code_versions
            WHERE {where} AND version_number IN (
                (SELECT MIN(version_number) FROM code_versions WHERE {where}),
                (SELECT MAX(version_number) FROM code_versions WHERE {where})
            )
            ORDER BY version_number ASC
            """,
            [*args, *args, *args],
        ).fetchall()
        first_to_last = build_diff(ends[0][0], ends[1][0])
    else:
        first_to_last = {"added_lines": 0, "removed_lines": 0, "changed_lines": 0}
    latest_code = None
    if include_latest_code and summary_rows:
        latest_code = c.execute(
            f"""
            SELECT code_content FROM code_versions
            WHERE {where}
            ORDER BY version_number DESC
            LIMIT 1
            """,
            args,
        ).fetchone()[0]
    return {
        "user_id": user_id,
        "contest_id": contest_id,
        "match_id": match_id,
        "task_id": task_id,
        "total": total,
        "limit": limit,
        "offset": offset,
        "versions": versions,
        "analytics": summarize_versions(summary_rows, first_to_last),
        "latest_code": latest_code,
        "disclaimer": DISCLAIMER,
    }


def attach_routes(app, *, connection, current_user, require_role):
    del require_role

    @app.post("/api/code-history/versions")
    def create_version(body: VersionIn, user=Depends(current_user)):
        if body.change_type not in CLIENT_CHANGE_TYPES:
            raise HTTPException(422, "Этот тип версии создаётся при отправке решения")
        with connection() as c:
            _assert_writer(c, user, body.contest_id, body.match_id, body.task_id)
            version, created = save_version(
                c,
                user_id=user["id"],
                contest_id=body.contest_id,
                match_id=body.match_id,
                task_id=body.task_id,
                session_id=body.session_id,
                code_content=body.code_content,
                change_type=body.change_type,
                client_request_id=body.client_request_id,
                submission_id=None,
            )
        return {**version, "created": created}

    @app.get("/api/code-history/tasks/{task_id}")
    def task_history(
        task_id: int,
        contest_id: int | None = None,
        match_id: int | None = None,
        user_id: int | None = None,
        limit: int = Query(default=30, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        include_latest_code: bool = False,
        user=Depends(current_user),
    ):
        owner_id = user_id or user["id"]
        with connection() as c:
            _assert_reader(
                c,
                user,
                owner_id=owner_id,
                contest_id=contest_id,
                match_id=match_id,
            )
            if user["id"] == owner_id and user["role"] == "participant":
                _assert_task_in_scope(c, contest_id, match_id, task_id)
            return list_history(
                c,
                user_id=owner_id,
                contest_id=contest_id,
                match_id=match_id,
                task_id=task_id,
                limit=limit,
                offset=offset,
                include_latest_code=include_latest_code and True,
            )

    @app.get("/api/code-history/versions/{version_id}")
    def read_version(version_id: int, user=Depends(current_user)):
        with connection() as c:
            version = _load_version(c, version_id)
            _assert_reader(
                c,
                user,
                owner_id=version["user_id"],
                contest_id=version["contest_id"],
                match_id=version["match_id"],
            )
        return version

    @app.get("/api/code-history/versions/{version_id}/diff/{other_version_id}")
    def diff_versions(version_id: int, other_version_id: int, user=Depends(current_user)):
        if version_id == other_version_id:
            raise HTTPException(422, "Нужны две разные версии")
        with connection() as c:
            left = _load_version(c, version_id)
            right = _load_version(c, other_version_id)
            _assert_reader(
                c,
                user,
                owner_id=left["user_id"],
                contest_id=left["contest_id"],
                match_id=left["match_id"],
            )
            if (
                left["user_id"] != right["user_id"]
                or left["task_id"] != right["task_id"]
                or left["contest_id"] != right["contest_id"]
                or left["match_id"] != right["match_id"]
            ):
                raise HTTPException(422, "Версии относятся к разным решениям")
        diff = build_diff(left["code_content"], right["code_content"])
        return {
            "from_version_id": left["id"],
            "to_version_id": right["id"],
            "from_version_number": left["version_number"],
            "to_version_number": right["version_number"],
            **diff,
        }

    @app.get("/api/code-history/submissions/{submission_id}")
    def version_for_submission(submission_id: int, user=Depends(current_user)):
        with connection() as c:
            row = c.execute(
                f"SELECT {_COLUMNS} FROM code_versions WHERE submission_id=%s",
                (submission_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Для отправки нет сохранённой версии")
            version = _version_dict(row, include_code=True)
            _assert_reader(
                c,
                user,
                owner_id=version["user_id"],
                contest_id=version["contest_id"],
                match_id=version["match_id"],
            )
        return version

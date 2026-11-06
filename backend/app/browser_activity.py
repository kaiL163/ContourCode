"""Browser activity monitoring: validation, stats, and contest-scoped API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

EVENT_TYPES = (
    "TAB_HIDDEN",
    "TAB_VISIBLE",
    "WINDOW_BLUR",
    "WINDOW_FOCUS",
    "FULLSCREEN_EXIT",
    "FULLSCREEN_ENTER",
    "PAGE_EXIT",
    "CONTEXT_MENU",
    "COPY",
    "PASTE",
)
MAX_BATCH = 50
RETENTION_DAYS = 90
HIGH_BLUR_THRESHOLD = 8
MAX_CLIENT_SKEW = timedelta(minutes=2)
SESSION_GRACE = timedelta(seconds=30)
POLICY = {
    "retention_days": RETENTION_DAYS,
    "collects": list(EVENT_TYPES),
    "does_not_collect": [
        "содержимое других вкладок",
        "открытые приложения",
        "запись экрана",
        "камера и микрофон",
        "содержимое буфера обмена",
    ],
    "purpose": "Информационные сигналы для организатора. Потеря фокуса не считается доказательством нарушения.",
}


class ActivityEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: UUID
    event_type: str
    client_timestamp: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActivityBatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    events: list[ActivityEventIn] = Field(min_length=1, max_length=MAX_BATCH)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def contest_is_active(starts_at, duration_minutes, now=None) -> bool:
    moment = now or _now()
    start = _aware(starts_at)
    if start is None:
        return False
    end = start + timedelta(minutes=duration_minutes)
    return start <= moment < end


def sanitize_metadata(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return {}
    clean: dict[str, Any] = {}
    visibility = raw.get("visibility_state")
    if visibility in ("hidden", "visible"):
        clean["visibility_state"] = visibility
    if isinstance(raw.get("fullscreen"), bool):
        clean["fullscreen"] = raw["fullscreen"]
    source = raw.get("source")
    if isinstance(source, str) and source and len(source) <= 40:
        clean["source"] = source
    return clean


def occurred_at_for(client_timestamp: datetime, received_at: datetime) -> tuple[datetime, bool]:
    client = _aware(client_timestamp) or received_at
    if abs(client - received_at) > MAX_CLIENT_SKEW:
        return received_at, True
    return client, False


def _ms(delta: timedelta) -> int:
    return max(0, int(delta.total_seconds() * 1000))


def _pair_intervals(events: list[dict], start_type: str, end_type: str):
    opened = None
    intervals = []
    for event in events:
        kind = event["event_type"]
        when = event["occurred_at"]
        if kind == start_type and opened is None:
            opened = event
        elif kind == end_type and opened is not None:
            intervals.append(
                {
                    "kind": start_type,
                    "started_at": opened["occurred_at"],
                    "ended_at": when,
                    "start_event_id": str(opened["event_id"]),
                    "end_event_id": str(event["event_id"]),
                    "duration_ms": _ms(when - opened["occurred_at"]),
                    "duration_unknown": False,
                }
            )
            opened = None
    if opened is not None:
        intervals.append(
            {
                "kind": start_type,
                "started_at": opened["occurred_at"],
                "ended_at": None,
                "start_event_id": str(opened["event_id"]),
                "end_event_id": None,
                "duration_ms": None,
                "duration_unknown": True,
            }
        )
    return intervals


def _closed(intervals: list[dict]) -> list[tuple[datetime, datetime]]:
    return [
        (item["started_at"], item["ended_at"])
        for item in intervals
        if item["ended_at"] is not None
    ]


def _subtract(interval: tuple[datetime, datetime], masks: list[tuple[datetime, datetime]]):
    pieces = [interval]
    for mask_start, mask_end in masks:
        next_pieces = []
        for start, end in pieces:
            if mask_end <= start or mask_start >= end:
                next_pieces.append((start, end))
                continue
            if mask_start > start:
                next_pieces.append((start, min(mask_start, end)))
            if mask_end < end:
                next_pieces.append((max(mask_end, start), end))
        pieces = [(a, b) for a, b in next_pieces if b > a]
    return pieces


def compute_participant_stats(events: list[dict]) -> dict[str, Any]:
    ordered = sorted(
        events,
        key=lambda item: (_aware(item["occurred_at"]), item.get("id") or 0),
    )
    hidden = _pair_intervals(ordered, "TAB_HIDDEN", "TAB_VISIBLE")
    blur = _pair_intervals(ordered, "WINDOW_BLUR", "WINDOW_FOCUS")
    hidden_masks = _closed(hidden)
    blur_exclusive_ms = 0
    blur_unknown = sum(1 for item in blur if item["duration_unknown"])
    for item in blur:
        if item["duration_unknown"] or item["ended_at"] is None:
            continue
        for start, end in _subtract((item["started_at"], item["ended_at"]), hidden_masks):
            blur_exclusive_ms += _ms(end - start)
    hidden_ms = sum(item["duration_ms"] or 0 for item in hidden if not item["duration_unknown"])
    last = ordered[-1]["occurred_at"] if ordered else None
    return {
        "event_count": len(ordered),
        "tab_switches": sum(1 for item in ordered if item["event_type"] == "TAB_HIDDEN"),
        "tab_hidden_ms": hidden_ms,
        "tab_hidden_unknown_intervals": sum(1 for item in hidden if item["duration_unknown"]),
        "window_blurs": sum(1 for item in ordered if item["event_type"] == "WINDOW_BLUR"),
        "window_blur_ms": blur_exclusive_ms,
        "window_blur_unknown_intervals": blur_unknown,
        "fullscreen_exits": sum(1 for item in ordered if item["event_type"] == "FULLSCREEN_EXIT"),
        "copy_count": sum(1 for item in ordered if item["event_type"] == "COPY"),
        "paste_count": sum(1 for item in ordered if item["event_type"] == "PASTE"),
        "last_activity_at": last,
        "hidden_intervals": hidden,
        "blur_intervals": blur,
        "timeline": [
            {
                "event_id": str(item["event_id"]),
                "event_type": item["event_type"],
                "occurred_at": item["occurred_at"],
                "timestamp_untrusted": bool(
                    (item.get("metadata") or {}).get("timestamp_untrusted")
                ),
                "duration_ms": None,
                "duration_unknown": False,
            }
            for item in ordered
        ],
    }


def attach_interval_durations(stats: dict[str, Any]) -> dict[str, Any]:
    lookup = {}
    for group in ("hidden_intervals", "blur_intervals"):
        for interval in stats[group]:
            lookup[interval["start_event_id"]] = interval
    for row in stats["timeline"]:
        interval = lookup.get(row["event_id"])
        if not interval:
            continue
        row["duration_ms"] = interval["duration_ms"]
        row["duration_unknown"] = interval["duration_unknown"]
    return stats


def empty_stats() -> dict[str, Any]:
    return compute_participant_stats([])


def _load_contest(c, contest_id: int):
    row = c.execute(
        "SELECT id, title, starts_at, duration_minutes, organizer_id FROM contests WHERE id=%s",
        (contest_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Контест не найден")
    return dict(
        zip(("id", "title", "starts_at", "duration_minutes", "organizer_id"), row)
    )


def _require_organizer(contest: dict, user: dict):
    if user["role"] != "organizer" or contest["organizer_id"] != user["id"]:
        raise HTTPException(403, "Только организатор контеста")


def _registered(c, contest_id: int, user_id: int) -> bool:
    return bool(
        c.execute(
            "SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s",
            (contest_id, user_id),
        ).fetchone()
    )


def purge_expired(c) -> None:
    c.execute(
        "DELETE FROM browser_activity_events WHERE created_at < now() - (%s * interval '1 day')",
        (RETENTION_DAYS,),
    )


def start_session(c, user: dict, contest: dict) -> dict:
    if user["role"] != "participant":
        raise HTTPException(403, "Мониторинг включается только для участников")
    if not _registered(c, contest["id"], user["id"]):
        raise HTTPException(403, "Сначала зарегистрируйтесь на соревнование")
    if not contest_is_active(contest["starts_at"], contest["duration_minutes"]):
        raise HTTPException(409, "Мониторинг доступен только во время активного соревнования")
    open_row = c.execute(
        """
        SELECT id, started_at, last_seen_at FROM browser_activity_sessions
        WHERE user_id=%s AND contest_id=%s AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1
        """,
        (user["id"], contest["id"]),
    ).fetchone()
    now = _now()
    if open_row:
        c.execute(
            "UPDATE browser_activity_sessions SET last_seen_at=%s WHERE id=%s",
            (now, open_row[0]),
        )
        session_id = open_row[0]
        started_at = open_row[1]
    else:
        session_id = uuid4()
        started_at = now
        c.execute(
            """
            INSERT INTO browser_activity_sessions(id,user_id,contest_id,started_at,last_seen_at)
            VALUES (%s,%s,%s,%s,%s)
            """,
            (session_id, user["id"], contest["id"], now, now),
        )
    purge_expired(c)
    return {
        "session_id": str(session_id),
        "contest_id": contest["id"],
        "user_id": user["id"],
        "started_at": started_at,
        "monitoring_enabled": True,
        "policy": POLICY,
    }


def end_session(c, user: dict, contest_id: int, session_id: UUID) -> dict:
    row = c.execute(
        """
        UPDATE browser_activity_sessions
        SET ended_at=COALESCE(ended_at, now()), last_seen_at=now()
        WHERE id=%s AND user_id=%s AND contest_id=%s
        RETURNING id
        """,
        (session_id, user["id"], contest_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Сессия мониторинга не найдена")
    return {"session_id": str(session_id), "ended": True}


def ingest_events(c, user: dict, contest: dict, body: ActivityBatchIn) -> dict:
    from psycopg.types.json import Json

    if user["role"] != "participant":
        raise HTTPException(403, "Отправлять события может только участник")
    if not _registered(c, contest["id"], user["id"]):
        raise HTTPException(403, "Вы не участвуете в этом соревновании")
    session = c.execute(
        """
        SELECT id, user_id, contest_id, ended_at FROM browser_activity_sessions
        WHERE id=%s
        """,
        (body.session_id,),
    ).fetchone()
    if not session:
        raise HTTPException(404, "Сессия мониторинга не найдена")
    if session[1] != user["id"] or session[2] != contest["id"]:
        raise HTTPException(403, "Сессия принадлежит другому участнику или контесту")
    now = _now()
    ended_at = _aware(session[3])
    if ended_at and now - ended_at > SESSION_GRACE:
        raise HTTPException(409, "Сессия мониторинга уже завершена")
    if not contest_is_active(contest["starts_at"], contest["duration_minutes"], now):
        only_exit = all(item.event_type == "PAGE_EXIT" for item in body.events)
        if not only_exit:
            raise HTTPException(409, "Соревнование уже не активно")
    accepted = 0
    duplicates = 0
    for item in body.events:
        if item.event_type not in EVENT_TYPES:
            raise HTTPException(422, "Недопустимый тип события")
        occurred, untrusted = occurred_at_for(item.client_timestamp, now)
        metadata = sanitize_metadata(item.metadata)
        if untrusted:
            metadata["timestamp_untrusted"] = True
        inserted = c.execute(
            """
            INSERT INTO browser_activity_events(
                event_id,user_id,contest_id,session_id,event_type,occurred_at,client_timestamp,metadata
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING id
            """,
            (
                item.event_id,
                user["id"],
                contest["id"],
                body.session_id,
                item.event_type,
                occurred,
                _aware(item.client_timestamp),
                Json(metadata),
            ),
        ).fetchone()
        if inserted:
            accepted += 1
        else:
            duplicates += 1
    c.execute(
        "UPDATE browser_activity_sessions SET last_seen_at=%s WHERE id=%s",
        (now, body.session_id),
    )
    purge_expired(c)
    return {"accepted": accepted, "duplicates": duplicates}


def _events_for(c, contest_id: int, user_id: int | None = None) -> list[dict]:
    params: list[Any] = [contest_id]
    extra = ""
    if user_id is not None:
        extra = " AND user_id=%s"
        params.append(user_id)
    rows = c.execute(
        f"""
        SELECT id, event_id, user_id, contest_id, session_id, event_type,
               occurred_at, client_timestamp, metadata, created_at
        FROM browser_activity_events
        WHERE contest_id=%s{extra}
        ORDER BY occurred_at, id
        """,
        params,
    ).fetchall()
    keys = (
        "id",
        "event_id",
        "user_id",
        "contest_id",
        "session_id",
        "event_type",
        "occurred_at",
        "client_timestamp",
        "metadata",
        "created_at",
    )
    return [dict(zip(keys, row)) for row in rows]


SORTABLE = {
    "display_name": "display_name",
    "tab_switches": "tab_switches",
    "tab_hidden_ms": "tab_hidden_ms",
    "window_blurs": "window_blurs",
    "fullscreen_exits": "fullscreen_exits",
    "last_activity_at": "last_activity_at",
    "event_count": "event_count",
}


def participant_summaries(c, contest_id: int) -> list[dict]:
    people = c.execute(
        """
        SELECT u.id, u.username, u.display_name
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        WHERE r.contest_id=%s
        ORDER BY u.display_name, u.id
        """,
        (contest_id,),
    ).fetchall()
    events = _events_for(c, contest_id)
    by_user: dict[int, list[dict]] = {}
    for event in events:
        by_user.setdefault(event["user_id"], []).append(event)
    rows = []
    for uid, username, display_name in people:
        stats = compute_participant_stats(by_user.get(uid, []))
        rows.append(
            {
                "user_id": uid,
                "username": username,
                "display_name": display_name,
                "tab_switches": stats["tab_switches"],
                "tab_hidden_ms": stats["tab_hidden_ms"],
                "tab_hidden_unknown_intervals": stats["tab_hidden_unknown_intervals"],
                "window_blurs": stats["window_blurs"],
                "window_blur_ms": stats["window_blur_ms"],
                "window_blur_unknown_intervals": stats["window_blur_unknown_intervals"],
                "fullscreen_exits": stats["fullscreen_exits"],
                "copy_count": stats["copy_count"],
                "paste_count": stats["paste_count"],
                "event_count": stats["event_count"],
                "last_activity_at": stats["last_activity_at"],
            }
        )
    return rows


def contest_overview(c, contest: dict) -> dict:
    rows = participant_summaries(c, contest["id"])
    return {
        "contest_id": contest["id"],
        "title": contest["title"],
        "participant_count": len(rows),
        "tab_switches": sum(item["tab_switches"] for item in rows),
        "event_count": sum(item["event_count"] for item in rows),
        "high_focus_loss_participants": sum(
            1 for item in rows if item["window_blurs"] >= HIGH_BLUR_THRESHOLD
        ),
        "high_focus_loss_threshold": HIGH_BLUR_THRESHOLD,
        "retention_days": RETENTION_DAYS,
        "disclaimer": POLICY["purpose"],
        "policy": POLICY,
    }


def attach_routes(app, *, connection, current_user, require_role):
    @app.post("/api/contests/{cid}/browser-activity/session")
    def open_activity_session(cid: int, user=Depends(require_role("participant"))):
        with connection() as c:
            contest = _load_contest(c, cid)
            return start_session(c, user, contest)

    @app.post("/api/contests/{cid}/browser-activity/session/end")
    def close_activity_session(
        cid: int, body: dict, user=Depends(require_role("participant"))
    ):
        session_id = body.get("session_id")
        try:
            parsed = UUID(str(session_id))
        except Exception as exc:
            raise HTTPException(422, "Нужен session_id") from exc
        with connection() as c:
            if not c.execute("SELECT 1 FROM contests WHERE id=%s", (cid,)).fetchone():
                raise HTTPException(404, "Контест не найден")
            return end_session(c, user, cid, parsed)

    @app.post("/api/contests/{cid}/browser-activity/events")
    def post_activity_events(
        cid: int, body: ActivityBatchIn, user=Depends(current_user)
    ):
        with connection() as c:
            contest = _load_contest(c, cid)
            return ingest_events(c, user, contest, body)

    @app.get("/api/contests/{cid}/browser-activity/summary")
    def activity_summary(cid: int, user=Depends(require_role("organizer"))):
        with connection() as c:
            contest = _load_contest(c, cid)
            _require_organizer(contest, user)
            return contest_overview(c, contest)

    @app.get("/api/contests/{cid}/browser-activity/participants")
    def activity_participants(
        cid: int,
        user=Depends(require_role("organizer")),
        q: str = "",
        sort: str = Query(default="display_name"),
        order: str = Query(default="asc"),
    ):
        if sort not in SORTABLE:
            raise HTTPException(422, "Недопустимое поле сортировки")
        descending = order.lower() == "desc"
        with connection() as c:
            contest = _load_contest(c, cid)
            _require_organizer(contest, user)
            rows = participant_summaries(c, cid)
        needle = q.strip().casefold()
        if needle:
            rows = [
                item
                for item in rows
                if needle in item["display_name"].casefold()
                or needle in item["username"].casefold()
            ]

        def key(item):
            value = item[sort]
            return (value is None, value)

        rows.sort(key=key, reverse=descending)
        return {"contest_id": cid, "disclaimer": POLICY["purpose"], "rows": rows}

    @app.get("/api/contests/{cid}/browser-activity/participants/{uid}")
    def activity_participant_detail(
        cid: int, uid: int, user=Depends(require_role("organizer"))
    ):
        with connection() as c:
            contest = _load_contest(c, cid)
            _require_organizer(contest, user)
            person = c.execute(
                """
                SELECT u.id, u.username, u.display_name
                FROM registrations r JOIN users u ON u.id=r.user_id
                WHERE r.contest_id=%s AND r.user_id=%s
                """,
                (cid, uid),
            ).fetchone()
            if not person:
                raise HTTPException(404, "Участник контеста не найден")
            events = _events_for(c, cid, uid)
        stats = attach_interval_durations(compute_participant_stats(events))
        return {
            "contest_id": cid,
            "user_id": person[0],
            "username": person[1],
            "display_name": person[2],
            "disclaimer": POLICY["purpose"],
            "stats": {
                "tab_switches": stats["tab_switches"],
                "tab_hidden_ms": stats["tab_hidden_ms"],
                "tab_hidden_unknown_intervals": stats["tab_hidden_unknown_intervals"],
                "window_blurs": stats["window_blurs"],
                "window_blur_ms": stats["window_blur_ms"],
                "window_blur_unknown_intervals": stats["window_blur_unknown_intervals"],
                "fullscreen_exits": stats["fullscreen_exits"],
                "copy_count": stats["copy_count"],
                "paste_count": stats["paste_count"],
                "event_count": stats["event_count"],
                "last_activity_at": stats["last_activity_at"],
            },
            "events": [
                {
                    "event_id": str(item["event_id"]),
                    "event_type": item["event_type"],
                    "occurred_at": item["occurred_at"],
                    "session_id": str(item["session_id"]),
                    "timestamp_untrusted": bool(
                        (item.get("metadata") or {}).get("timestamp_untrusted")
                    ),
                    "duration_ms": next(
                        (
                            row["duration_ms"]
                            for row in stats["timeline"]
                            if row["event_id"] == str(item["event_id"])
                        ),
                        None,
                    ),
                    "duration_unknown": next(
                        (
                            row["duration_unknown"]
                            for row in stats["timeline"]
                            if row["event_id"] == str(item["event_id"])
                        ),
                        False,
                    ),
                }
                for item in events
            ],
            "timeline": stats["timeline"],
        }

    @app.delete("/api/contests/{cid}/browser-activity")
    def delete_activity(cid: int, user=Depends(require_role("organizer"))):
        with connection() as c:
            contest = _load_contest(c, cid)
            _require_organizer(contest, user)
            deleted_events = c.execute(
                "DELETE FROM browser_activity_events WHERE contest_id=%s", (cid,)
            ).rowcount
            deleted_sessions = c.execute(
                "DELETE FROM browser_activity_sessions WHERE contest_id=%s", (cid,)
            ).rowcount
        return {
            "deleted_events": int(deleted_events or 0),
            "deleted_sessions": int(deleted_sessions or 0),
            "retention_days": RETENTION_DAYS,
        }

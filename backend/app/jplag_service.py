"""Safe local wrapper around the official JPlag CLI for C++ submissions.

Public API: ``analyze_submissions(submissions, *, mode='individual', timeout=120,
jplag_command=None, basecode_dir=None)``. Each submission is a mapping with
``id``, ``source_code`` and optional ``team_id``. Modes: individual, duel, team.
Install the official JPlag CLI and Java runtime; put ``jplag`` on PATH or set
``JPLAG_COMMAND`` to an executable/command line.
"""
from __future__ import annotations
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Mapping, Sequence

class JPlagError(RuntimeError):
    """JPlag failed to produce a valid analysis."""

class JPlagUnavailableError(JPlagError):
    """The JPlag CLI is not installed or configured."""

class JPlagTimeoutError(JPlagError):
    """The JPlag CLI exceeded its time limit."""

DEFAULT_TIMEOUT = 120

def _run(args: Sequence[str], **kwargs):
    return subprocess.run(args, check=False, capture_output=True, text=True, **kwargs)

def _command(configured: str | None) -> list[str]:
    parts = shlex.split(configured or os.environ.get("JPLAG_COMMAND", "jplag"))
    if not parts or not (Path(parts[0]).is_file() or shutil.which(parts[0])):
        raise JPlagUnavailableError(f"JPlag CLI not found: {parts[0] if parts else '<empty>'}")
    return parts

def _read_json(archive: zipfile.ZipFile, name: str, default):
    try:
        return json.loads(archive.read(name))
    except KeyError:
        return default
    except json.JSONDecodeError as exc:
        raise JPlagError(f"Invalid JPlag report file: {name}") from exc

def _version(info: object) -> str | None:
    if isinstance(info, dict):
        for key in ("jplagVersion", "version", "JPlagVersion"):
            if info.get(key):
                return str(info[key])
    return None

def analyze_submissions(submissions: Sequence[Mapping], *, mode: str = "individual", timeout: int = DEFAULT_TIMEOUT,
                        jplag_command: str | None = None, basecode_dir: str | os.PathLike | None = None) -> dict:
    """Analyze C++ source without executing it; return JPlag report version/options/pairs.

    Input rows require ``id`` and ``source_code``; team mode also accepts
    ``team_id`` and omits same-team pairs from the returned comparisons.
    """
    if mode not in {"individual", "duel", "team"}:
        raise ValueError("mode must be individual, duel, or team")
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    rows = list(submissions)
    for row in rows:
        if "id" not in row or not isinstance(row.get("source_code"), str):
            raise ValueError("each submission requires id and string source_code")
    if len(rows) < 2 or (mode == "team" and len({r.get("team_id") for r in rows if r.get("team_id") is not None}) < 2):
        return {"version": None, "options": {}, "pairs": []}
    command = _command(jplag_command)
    with tempfile.TemporaryDirectory(prefix="jplag-") as tmp:
        root = Path(tmp)
        input_dir = root / "submissions"
        input_dir.mkdir(mode=0o700)
        ids = {}
        for index, row in enumerate(rows):
            name = f"submission_{index:06d}"
            if name in ids or any(existing["id"] == row["id"] for existing in ids.values()):
                raise ValueError("submission ids must be unique")
            ids[name] = row
            folder = input_dir / name
            folder.mkdir(mode=0o700)
            (folder / "main.cpp").write_text(row["source_code"], encoding="utf-8")
        report_base = root / "report"
        args = command + ["--mode", "RUN", "--language", "cpp", "--result-file", str(report_base), str(input_dir)]
        if basecode_dir is not None:
            basecode = Path(basecode_dir).resolve(strict=True)
            if not basecode.is_dir():
                raise ValueError("basecode_dir must be a directory")
            args[1:1] = ["--base-code", str(basecode)]
        try:
            completed = _run(args, timeout=timeout, cwd=root)
        except FileNotFoundError as exc:
            raise JPlagUnavailableError(f"JPlag CLI not found: {command[0]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise JPlagTimeoutError(f"JPlag exceeded {timeout} seconds") from exc
        if completed.returncode:
            raise JPlagError(f"JPlag exited with status {completed.returncode}: {completed.stderr[-2000:]}")
        report = Path(str(report_base) + ".jplag")
        if not report.is_file():
            raise JPlagError("JPlag completed without producing a .jplag report")
        try:
            with zipfile.ZipFile(report) as archive:
                info = _read_json(archive, "runInformation.json", {})
                options = _read_json(archive, "options.json", {})
                comparisons = _read_json(archive, "topComparisons.json", [])
        except (zipfile.BadZipFile, OSError) as exc:
            raise JPlagError("JPlag produced an unreadable report") from exc
        pairs = []
        for item in comparisons:
            if not isinstance(item, dict):
                continue
            left, right = item.get("submission1"), item.get("submission2")
            if left is None or right is None:
                continue
            left, right = str(left), str(right)
            if left not in ids or right not in ids:
                continue
            a, b = ids[left], ids[right]
            if mode == "team" and a.get("team_id") is not None and a.get("team_id") == b.get("team_id"):
                continue
            pairs.append({"submission1": a["id"], "submission2": b["id"],
                          "similarity": item.get("similarity", item.get("averageSimilarity")), "raw": item})
        return {"version": _version(info), "options": options, "pairs": pairs}

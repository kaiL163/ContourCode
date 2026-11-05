import json
import zipfile
from pathlib import Path

import pytest

from backend.app import jplag_service as service


def _report(path: Path, pairs):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("runInformation.json", json.dumps({"jplagVersion": "6.3.0"}))
        archive.writestr("options.json", json.dumps({"language": "cpp"}))
        archive.writestr("topComparisons.json", json.dumps(pairs))


def test_analyze_runs_cpp_and_reads_real_report_pairs(monkeypatch):
    seen = {}
    def runner(args, **kwargs):
        seen.update(args=args, kwargs=kwargs)
        output = Path(args[args.index("--result-file") + 1] + ".jplag")
        _report(output, [{"submission1": "submission_000000", "submission2": "submission_000001", "similarity": 0.73}])
        return type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()
    monkeypatch.setattr(service, "_run", runner)
    monkeypatch.setattr(service.shutil, "which", lambda _: "jplag")
    result = service.analyze_submissions([
        {"id": 1, "source_code": "int main(){return 0;}", "team_id": 7},
        {"id": 2, "source_code": "int main(){return 1;}", "team_id": 8},
    ], mode="team")
    assert result["version"] == "6.3.0"
    assert result["pairs"][0]["similarity"] == 0.73
    assert "cpp" in seen["args"]
    assert seen["kwargs"]["timeout"] > 0


def test_same_team_pairs_are_excluded_before_cli(monkeypatch):
    monkeypatch.setattr(service, "_run", lambda *a, **k: pytest.fail("CLI must not run"))
    monkeypatch.setattr(service.shutil, "which", lambda _: "jplag")
    result = service.analyze_submissions([
        {"id": 1, "source_code": "int a;", "team_id": 4},
        {"id": 2, "source_code": "int b;", "team_id": 4},
    ], mode="team")
    assert result["pairs"] == []
    assert result["version"] is None


def test_missing_jplag_is_explicit(monkeypatch):
    monkeypatch.setattr(service.shutil, "which", lambda _: None)
    with pytest.raises(service.JPlagUnavailableError):
        service.analyze_submissions([
            {"id": 1, "source_code": "int a;"},
            {"id": 2, "source_code": "int b;"},
        ])

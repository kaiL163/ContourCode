import asyncio
import base64
import json

import httpx
import pytest

from backend.app import checker


def run(coro):
    return asyncio.run(coro)


def test_submits_each_test_and_returns_ok(monkeypatch):
    calls = []

    async def handler(request):
        if request.method == "POST":
            calls.append(json.loads(request.content))
            return httpx.Response(201, json={"token": f"t{len(calls)}"})
        assert request.url.params["base64_encoded"] == "true"
        return httpx.Response(
            200,
            json={"status": {"id": 3, "description": "Accepted"}, "stdout": "Mgo=\n"},
        )

    monkeypatch.setenv("JUDGE0_URL", "http://judge")
    monkeypatch.setenv("JUDGE0_LANGUAGE_ID", "54")
    monkeypatch.setattr(
        checker, "_transport", httpx.MockTransport(handler), raising=False
    )
    verdict, error = run(
        checker.check_solution(
            "int main(){}",
            [{"input": "1", "output": "2"}, {"input": "2", "output": "2"}],
            1000,
            64000,
        )
    )
    assert (verdict, error) == ("OK", None)
    assert len(calls) == 2
    assert all(call["language_id"] == 54 for call in calls)
    assert all(
        call["cpu_time_limit"] == 1 and call["memory_limit"] == 64000 for call in calls
    )
    assert all(call["cpu_extra_time"] == 0.5 for call in calls)


@pytest.mark.parametrize(
    ("status_id", "description"),
    [
        (7, "Runtime Error (SIGSEGV)"),
        (8, "Runtime Error (SIGXFSZ)"),
        (9, "Runtime Error (SIGFPE)"),
        (10, "Runtime Error (SIGABRT)"),
        (11, "Runtime Error (NZEC)"),
        (12, "Runtime Error (Other)"),
    ],
)
def test_maps_all_judge0_runtime_errors(monkeypatch, status_id, description):
    async def handler(request):
        if request.method == "POST":
            return httpx.Response(201, json={"token": "x"})
        return httpx.Response(
            200,
            json={
                "status": {"id": status_id, "description": description},
                "stderr": base64.b64encode(b"runtime details").decode(),
            },
        )

    monkeypatch.setenv("JUDGE0_URL", "http://judge")
    monkeypatch.setenv("JUDGE0_LANGUAGE_ID", "54")
    monkeypatch.setattr(
        checker, "_transport", httpx.MockTransport(handler), raising=False
    )
    assert (
        run(checker.check_solution("code", [{"input": "", "output": ""}], 1000, 64000))[
            0
        ]
        == "RE"
    )


def test_maps_verdicts(monkeypatch):
    def run_status(description):
        n = 0

        async def handler(request):
            nonlocal n
            if request.method == "POST":
                return httpx.Response(201, json={"token": "x"})
            n += 1
            return httpx.Response(
                200,
                json={
                    "status": {
                        "id": (
                            5
                            if description == "Time Limit Exceeded"
                            else 6 if description == "Compilation Error" else 4
                        ),
                        "description": description,
                    },
                    "stdout": "d3Jvbmc=",
                },
            )

        monkeypatch.setenv("JUDGE0_URL", "http://judge")
        monkeypatch.setenv("JUDGE0_LANGUAGE_ID", "54")
        monkeypatch.setattr(
            checker, "_transport", httpx.MockTransport(handler), raising=False
        )
        return run(
            checker.check_solution("code", [{"input": "", "output": "ok"}], 1000, 64000)
        )

    for status, expected in [
        ("Wrong Answer", "WA"),
        ("Time Limit Exceeded", "TLE"),
        ("Compilation Error", "CE"),
    ]:
        assert run_status(status)[0] == expected


def test_token_comparison_and_service_failure(monkeypatch):
    async def handler(request):
        if request.method == "POST":
            return httpx.Response(201, json={"token": "x"})
        return httpx.Response(
            200,
            json={
                "status": {"id": 3, "description": "Accepted"},
                "stdout": base64.b64encode(b"  a\tb\n").decode(),
            },
        )

    monkeypatch.setenv("JUDGE0_URL", "http://judge")
    monkeypatch.setenv("JUDGE0_LANGUAGE_ID", "54")
    monkeypatch.setattr(
        checker, "_transport", httpx.MockTransport(handler), raising=False
    )
    assert run(
        checker.check_solution("code", [{"input": "", "output": "a b"}], 1000, 64000)
    ) == ("OK", None)
    assert (
        run(
            checker.check_solution(
                "code", [{"input": "", "output": "a c"}], 1000, 64000
            )
        )[0]
        == "WA"
    )

    monkeypatch.setattr(
        checker,
        "_transport",
        httpx.MockTransport(lambda request: httpx.Response(503)),
        raising=False,
    )
    verdict, error = run(
        checker.check_solution("code", [{"input": "", "output": ""}], 1000, 64000)
    )
    assert verdict == "CHECKER_ERROR" and error


@pytest.mark.parametrize(
    "diagnostic",
    [
        "judge crashed",
        "Failed to create control group /sys/fs/cgroup/memory/box-1/: No such file or directory; No such file or directory @ rb_sysopen - /box/main.cpp",
    ],
)
def test_internal_error_returns_judge_diagnostic(monkeypatch, diagnostic):
    async def handler(request):
        if request.method == "POST":
            return httpx.Response(201, json={"token": "x"})
        return httpx.Response(
            200,
            json={
                "status": {"id": 13, "description": "Internal Error"},
                "message": base64.b64encode(diagnostic.encode()).decode(),
            },
        )

    monkeypatch.setenv("JUDGE0_URL", "http://judge")
    monkeypatch.setenv("JUDGE0_LANGUAGE_ID", "54")
    monkeypatch.setattr(
        checker, "_transport", httpx.MockTransport(handler), raising=False
    )
    verdict, error = run(
        checker.check_solution("code", [{"input": "", "output": ""}], 1000, 64000)
    )
    assert verdict == "CHECKER_ERROR"
    assert error == diagnostic


def test_missing_configuration_returns_diagnostic(monkeypatch):
    monkeypatch.delenv("JUDGE0_URL", raising=False)
    monkeypatch.delenv("JUDGE0_LANGUAGE_ID", raising=False)
    verdict, error = run(
        checker.check_solution("code", [{"input": "", "output": ""}], 1000, 64000)
    )
    assert verdict == "CHECKER_ERROR"
    assert error


def test_timeout_maps_to_tle(monkeypatch):
    async def handler(request):
        if request.method == "POST":
            return httpx.Response(201, json={"token": "x"})
        return httpx.Response(
            200, json={"status": {"id": 5, "description": "Time Limit Exceeded"}}
        )

    monkeypatch.setenv("JUDGE0_URL", "http://judge")
    monkeypatch.setenv("JUDGE0_LANGUAGE_ID", "54")
    monkeypatch.setattr(
        checker, "_transport", httpx.MockTransport(handler), raising=False
    )
    assert (
        run(checker.check_solution("code", [{"input": "", "output": ""}], 1, 64))[0]
        == "TLE"
    )

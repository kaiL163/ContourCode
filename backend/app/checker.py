"""Judge0 CE integration. Configure JUDGE0_URL and JUDGE0_LANGUAGE_ID.

For the Judge0 C++17/GNU++17 toolchain, configure language_id in the
service environment (commonly 54); pin it to the ID exposed by that instance.
"""

import asyncio
import base64
import os
import re
from typing import Any
from urllib.parse import urljoin

import httpx

_transport: httpx.AsyncBaseTransport | None = None

_STATUS_VERDICTS = {
    "Accepted": "OK",
    "Wrong Answer": "WA",
    "Time Limit Exceeded": "TLE",
    "Compilation Error": "CE",
    "Runtime Error": "RE",
    "Runtime Error (NZEC)": "RE",
    "Runtime Error (SIGSEGV)": "RE",
    "Runtime Error (SIGXFSZ)": "RE",
    "Runtime Error (SIGFPE)": "RE",
    "Runtime Error (SIGABRT)": "RE",
    "Runtime Error (Other)": "RE",
    "Internal Error": "CHECKER_ERROR",
    "Internal Error (Judge0)": "CHECKER_ERROR",
}


async def _one_test(client: httpx.AsyncClient, base_url: str, source_code: str,
                    test: dict[str, Any], time_limit_ms: int,
                    memory_limit_kb: int, language_id: int) -> tuple[str, str | None]:
    payload = {
        "source_code": source_code,
        "language_id": language_id,
        "stdin": test["input"],
        "cpu_time_limit": time_limit_ms / 1000,
        "cpu_extra_time": 0.5,
        "wall_time_limit": max(time_limit_ms / 1000 * 2, time_limit_ms / 1000 + 1),
        "memory_limit": memory_limit_kb,
    }
    response = await client.post(urljoin(base_url.rstrip("/") + "/", "submissions?base64_encoded=false&wait=false"), json=payload)
    response.raise_for_status()
    token = response.json().get("token")
    if not isinstance(token, str) or not token:
        raise ValueError("Judge0 omitted submission token")

    deadline = asyncio.get_running_loop().time() + max(15.0, time_limit_ms / 1000 * 4 + 5)
    while asyncio.get_running_loop().time() < deadline:
        result_response = await client.get(urljoin(base_url.rstrip("/") + "/", f"submissions/{token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,message"))
        result_response.raise_for_status()
        result = result_response.json()
        for field in ("stdout", "stderr", "compile_output", "message"):
            if result.get(field) is not None:
                result[field] = base64.b64decode(result[field]).decode("utf-8", errors="replace")
        status = result.get("status") or {}
        description = status.get("description")
        if description not in ("In Queue", "Processing"):
            verdict = _STATUS_VERDICTS.get(description)
            if verdict is None:
                raise ValueError(f"Unknown Judge0 status: {description!r}")
            if verdict == "OK":
                expected = re.findall(r"\S+", test["output"])
                actual = re.findall(r"\S+", result.get("stdout") or "")
                return ("OK", None) if expected == actual else ("WA", None)
            if verdict == "CHECKER_ERROR":
                diagnostic = result.get("message") or result.get("stderr") or result.get("compile_output") or description
                return verdict, str(diagnostic or "Judge0 reported an internal error")
            return verdict, None
        await asyncio.sleep(0.1)
    raise TimeoutError("Judge0 submission polling timed out")


async def check_solution(source_code: str, tests: list[dict], time_limit_ms: int,
                         memory_limit_kb: int) -> tuple[str, str | None]:
    """Submit each test to Judge0, enforcing task CPU and memory limits."""
    if not tests:
        return "CHECKER_ERROR", "No tests provided"
    try:
        base_url = os.environ["JUDGE0_URL"]
        language_id = int(os.environ["JUDGE0_LANGUAGE_ID"])
        if time_limit_ms <= 0 or memory_limit_kb <= 0:
            raise ValueError("time_limit_ms and memory_limit_kb must be positive")
        if not base_url:
            raise ValueError("JUDGE0_URL is empty")
        async with httpx.AsyncClient(transport=_transport, timeout=httpx.Timeout(10.0, read=30.0)) as client:
            for test in tests:
                verdict, error = await _one_test(client, base_url, source_code, test, time_limit_ms, memory_limit_kb, language_id)
                if verdict != "OK":
                    return verdict, error
        return "OK", None
    except httpx.TimeoutException as exc:
        return "CHECKER_ERROR", f"Judge0 request timed out: {exc}"
    except Exception as exc:
        return "CHECKER_ERROR", f"Judge0 checker failure: {exc}"

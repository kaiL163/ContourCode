"""Check frontend examples with local Judge0 without adding contest submissions."""

import asyncio
import json
import os
import sys

import psycopg
from app.checker import check_solution


def main():
    tasks = json.load(sys.stdin)
    expected = ("OK", "WA", "TLE", "RE", "CE")
    if not tasks:
        raise SystemExit("Не найдено поддерживаемых задач.")
    failed = []
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for task in tasks:
            settings = conn.execute(
                "SELECT time_limit_ms,memory_limit_kb FROM tasks WHERE id=%s",
                (task["id"],),
            ).fetchone()
            tests = [
                {"input": r[0], "output": r[1]}
                for r in conn.execute(
                    "SELECT input,output FROM task_tests WHERE task_id=%s ORDER BY id",
                    (task["id"],),
                ).fetchall()
            ]
            if not settings or not tests:
                raise SystemExit(f"Нет тестов для задачи {task['title']}")
            verdicts = []
            for code in expected:
                result, error = asyncio.run(
                    check_solution(
                        task["examples"]["Демонстрация: " + code], tests, *settings
                    )
                )
                verdicts.append(f"{code}={result}")
                if result != code:
                    failed.append((task["title"], code, result, error))
            print(f"{task['title']}: {'; '.join(verdicts)}", flush=True)
    for title, wanted, result, error in failed:
        print(
            f"ОШИБКА: {title}: ожидался {wanted}, получен {result}: {error}", flush=True
        )
    if failed:
        raise SystemExit(1)
    print(
        f"Проверены {len(tasks)} задач и {len(tasks)*len(expected)} примеров.",
        flush=True,
    )


if __name__ == "__main__":
    main()

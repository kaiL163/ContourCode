import type { Verdict } from "./api";

const labels: Record<Verdict, string> = {
  QUEUED: "В очереди",
  RUNNING: "Проверяется",
  OK: "Принято",
  WA: "Неверный ответ",
  TLE: "Превышено время",
  RE: "Ошибка выполнения",
  CE: "Ошибка компиляции",
  CHECKER_ERROR: "Ошибка проверки",
};

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`verdict-badge verdict-${verdict.toLowerCase()}`}>
      <strong>
        {verdict === "QUEUED" ||
        verdict === "RUNNING" ||
        verdict === "CHECKER_ERROR"
          ? ""
          : `${verdict} · `}
      </strong>
      {labels[verdict] ?? verdict}
    </span>
  );
}

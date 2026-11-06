export type SumDemoName =
  | "Демонстрация: OK"
  | "Демонстрация: WA"
  | "Демонстрация: TLE"
  | "Демонстрация: RE"
  | "Демонстрация: CE";

export const sumDemoNames: SumDemoName[] = [
  "Демонстрация: OK",
  "Демонстрация: WA",
  "Демонстрация: TLE",
  "Демонстрация: RE",
  "Демонстрация: CE",
];

type DemoTask = { title: string; statement: string };

const correctBodies: Record<string, { statement: string; body: string }> = {
  "Сумма двух чисел": {
    statement: "Выведите сумму двух целых чисел.",
    body: "long long a, b;\n  cin >> a >> b;\n  cout << a + b << '\\n';",
  },
  "Удвоение числа": {
    statement: "Выведите удвоенное целое число.",
    body: "long long n;\n  cin >> n;\n  cout << n * 2 << '\\n';",
  },
  "Максимум двух чисел": {
    statement: "Даны два целых числа. Выведите большее из них.",
    body: "long long a, b;\n  cin >> a >> b;\n  cout << (a > b ? a : b) << '\\n';",
  },
  "Чётность числа": {
    statement:
      "Дано целое число. Выведите EVEN, если оно чётное, и ODD в противном случае.",
    body: 'long long n;\n  cin >> n;\n  cout << (n % 2 == 0 ? "EVEN" : "ODD") << \'\\n\';',
  },
  "Сумма от единицы до N": {
    statement:
      "Дано целое число N от 1 до 1000000. Выведите сумму всех целых чисел от 1 до N включительно.",
    body: "long long n;\n  cin >> n;\n  cout << n * (n + 1) / 2 << '\\n';",
  },
};

export function demoExamplesForTask(
  task: DemoTask | undefined,
): Record<SumDemoName, string> | null {
  if (!task) return null;
  const isVerdictTask =
    sumDemoNames.includes(task.title as SumDemoName) &&
    task.statement.trim() === "Вводятся два целых числа. Выведите их сумму.";
  const definition = isVerdictTask
    ? correctBodies["Сумма двух чисел"]
    : correctBodies[task.title];
  if (
    !definition ||
    (!isVerdictTask && task.statement.trim() !== definition.statement)
  )
    return null;
  return {
    "Демонстрация: OK": `#include <iostream>\nusing namespace std;\n\nint main() {\n  ${definition.body}\n  return 0;\n}`,
    "Демонстрация: WA": `#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << "WRONG" << '\\n'; // намеренно неверный ответ\n  return 0;\n}`,
    "Демонстрация: TLE": `int main() {\n  volatile unsigned long long n = 0;\n  while (true) { ++n; } // намеренно бесконечный цикл\n}`,
    "Демонстрация: RE": `#include <cstdlib>\n\nint main() {\n  std::abort(); // намеренное аварийное завершение\n}`,
    "Демонстрация: CE": `int main() {\n  return 0 // намеренно пропущена точка с запятой\n}`,
  };
}

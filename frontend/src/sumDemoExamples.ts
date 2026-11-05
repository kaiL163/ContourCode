export type SumDemoName = 'Демонстрация: OK' | 'Демонстрация: WA' | 'Демонстрация: TLE' | 'Демонстрация: RE' | 'Демонстрация: CE';

export const sumDemoExamples: Record<SumDemoName, string> = {
  'Демонстрация: OK': `#include <iostream>\nusing namespace std;\n\nint main() {\n  long long a, b;\n  cin >> a >> b;\n  cout << a + b << '\\n';\n  return 0;\n}`,
  'Демонстрация: WA': `#include <iostream>\nusing namespace std;\n\nint main() {\n  long long a, b;\n  cin >> a >> b;\n  cout << a - b << '\\n'; // намеренно неверный ответ\n  return 0;\n}`,
  'Демонстрация: TLE': `#include <iostream>\nusing namespace std;\n\nint main() {\n  long long a, b;\n  cin >> a >> b;\n  volatile unsigned int n = 0;\n  while (true) { ++n; } // намеренно бесконечный цикл\n  return 0;\n}`,
  'Демонстрация: RE': `#include <iostream>\n#include <cstdlib>\nusing namespace std;\n\nint main() {\n  long long a, b;\n  cin >> a >> b;\n  cout << a + b << '\\n';\n  abort(); // намеренное аварийное завершение\n}`,
  'Демонстрация: CE': `#include <iostream>\nusing namespace std;\n\nint main() {\n  long long a, b;\n  cin >> a >> b;\n  cout << (a + b) << '\\n' // намеренно пропущена точка с запятой\n  return 0;\n}`,
};

export const sumDemoNames = Object.keys(sumDemoExamples) as SumDemoName[];

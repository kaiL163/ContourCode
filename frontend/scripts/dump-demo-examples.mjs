// Input: task id/title/statement from the database. Output: exact editor examples.
import { demoExamplesForTask } from '../src/sumDemoExamples.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const tasks = JSON.parse(input).flatMap(task => {
  const examples = demoExamplesForTask(task);
  return examples ? [{ ...task, examples }] : [];
});
process.stdout.write(JSON.stringify(tasks));

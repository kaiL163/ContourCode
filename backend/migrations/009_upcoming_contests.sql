-- Upcoming sample rounds, added once without modifying existing contests.
WITH upcoming(title, description, days_ahead, duration) AS (VALUES
  ('Вечерняя разминка', 'Короткий раунд на простые условия и вычисления. Подойдёт, чтобы потренироваться перед соревнованием.', 14, 60),
  ('Практика алгоритмов', 'Три задачи на сравнение чисел, проверку чётности и вычисление суммы.', 28, 90),
  ('Раунд по основам', 'Индивидуальный контест с задачами на основы программирования и работу с целыми числами.', 42, 120)
)
INSERT INTO contests(title, description, starts_at, duration_minutes, organizer_id)
SELECT u.title, u.description, date_trunc('day', now()) + make_interval(days => u.days_ahead, hours => 15), u.duration, owner.id
FROM upcoming u JOIN users owner ON owner.username='demo-organizer'
WHERE NOT EXISTS (SELECT 1 FROM contests c WHERE c.title=u.title AND c.organizer_id=owner.id);

WITH examples(title, statement) AS (VALUES
  ('Максимум двух чисел', 'Даны два целых числа. Выведите большее из них.'),
  ('Чётность числа', 'Дано целое число. Выведите EVEN, если оно чётное, и ODD в противном случае.'),
  ('Сумма от единицы до N', 'Дано целое число N от 1 до 1000000. Выведите сумму всех целых чисел от 1 до N включительно.')
)
INSERT INTO tasks(title, statement, time_limit_ms, memory_limit_kb, owner_id)
SELECT e.title, e.statement, 1000, 65536, owner.id FROM examples e JOIN users owner ON owner.username='demo-organizer'
WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.title=e.title AND t.owner_id=owner.id);

WITH examples(title, input, output, hidden) AS (VALUES
  ('Максимум двух чисел', '3 7', '7', false), ('Максимум двух чисел', '-2 -5', '-2', true),
  ('Чётность числа', '4', 'EVEN', false), ('Чётность числа', '7', 'ODD', true),
  ('Сумма от единицы до N', '5', '15', false), ('Сумма от единицы до N', '100', '5050', true)
)
INSERT INTO task_tests(task_id, input, output, is_hidden)
SELECT t.id,e.input,e.output,e.hidden FROM examples e JOIN users owner ON owner.username='demo-organizer' JOIN tasks t ON t.title=e.title AND t.owner_id=owner.id
WHERE NOT EXISTS (SELECT 1 FROM task_tests x WHERE x.task_id=t.id AND x.input=e.input AND x.output=e.output);

INSERT INTO contest_tasks(contest_id, task_id)
SELECT c.id,t.id FROM users owner JOIN contests c ON c.organizer_id=owner.id JOIN tasks t ON t.owner_id=owner.id
WHERE owner.username='demo-organizer' AND c.title IN ('Вечерняя разминка','Практика алгоритмов','Раунд по основам')
AND t.title IN ('Максимум двух чисел','Чётность числа','Сумма от единицы до N') ON CONFLICT DO NOTHING;

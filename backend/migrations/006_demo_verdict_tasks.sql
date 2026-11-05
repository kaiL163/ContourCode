-- Idempotent verdict-demo tasks; only insert missing named tasks and links.
WITH demo_tasks(title, statement) AS (
    VALUES
        ('Демонстрация: OK', 'Вводятся два целых числа. Выведите их сумму.'),
        ('Демонстрация: WA', 'Вводятся два целых числа. Выведите их сумму.'),
        ('Демонстрация: TLE', 'Вводятся два целых числа. Выведите их сумму.'),
        ('Демонстрация: RE', 'Вводятся два целых числа. Выведите их сумму.'),
        ('Демонстрация: CE', 'Вводятся два целых числа. Выведите их сумму.')
)
INSERT INTO tasks(title, statement, time_limit_ms, memory_limit_kb, owner_id)
SELECT d.title, d.statement, 1000, 262144, u.id
FROM demo_tasks d
JOIN users u ON u.username = 'demo-organizer'
WHERE NOT EXISTS (
    SELECT 1 FROM tasks existing WHERE existing.title = d.title
);

WITH demo_tests(title, input, output, is_hidden) AS (
    VALUES
        ('Демонстрация: OK', '1 2', '3', false),
        ('Демонстрация: OK', '-4 9', '5', true),
        ('Демонстрация: OK', '0 0', '0', true),
        ('Демонстрация: WA', '1 2', '3', false),
        ('Демонстрация: WA', '-4 9', '5', true),
        ('Демонстрация: WA', '0 0', '0', true),
        ('Демонстрация: TLE', '1 2', '3', false),
        ('Демонстрация: TLE', '-4 9', '5', true),
        ('Демонстрация: TLE', '0 0', '0', true),
        ('Демонстрация: RE', '1 2', '3', false),
        ('Демонстрация: RE', '-4 9', '5', true),
        ('Демонстрация: RE', '0 0', '0', true),
        ('Демонстрация: CE', '1 2', '3', false),
        ('Демонстрация: CE', '-4 9', '5', true),
        ('Демонстрация: CE', '0 0', '0', true)
)
INSERT INTO task_tests(task_id, input, output, is_hidden)
SELECT t.id, d.input, d.output, d.is_hidden
FROM demo_tests d
JOIN tasks t ON t.title = d.title
WHERE NOT EXISTS (
    SELECT 1 FROM task_tests existing
    WHERE existing.task_id = t.id AND existing.input = d.input
);

INSERT INTO contest_tasks(contest_id, task_id)
SELECT c.id, t.id
FROM contests c
JOIN users organizer ON organizer.id = c.organizer_id
JOIN tasks t ON t.title IN (
    'Демонстрация: OK', 'Демонстрация: WA', 'Демонстрация: TLE',
    'Демонстрация: RE', 'Демонстрация: CE'
)
WHERE c.title = 'Алгоритмический раунд'
  AND organizer.username = 'demo-organizer'
ON CONFLICT DO NOTHING;

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard'));

UPDATE tasks
SET difficulty = 'easy'
WHERE title IN ('Сумма двух чисел', 'Удвоение числа', 'Максимум двух чисел', 'Чётность числа');

UPDATE tasks
SET difficulty = 'medium'
WHERE title = 'Сумма от единицы до N';

WITH seed(title, statement, difficulty) AS (
    VALUES
        ('Палиндром числа', 'В единственной строке дано неотрицательное целое число x (0 ≤ x ≤ 10^9). Выведите YES, если десятичная запись числа читается одинаково слева направо и справа налево, иначе выведите NO.', 'medium'),
        ('Наибольшая сумма отрезка', 'В первой строке дано N (1 ≤ N ≤ 200000), во второй — N целых чисел от -10^9 до 10^9. Найдите наибольшую сумму непустого непрерывного фрагмента последовательности и выведите её.', 'hard'),
        ('Длина наибольшей возрастающей подпоследовательности', 'В первой строке дано N (1 ≤ N ≤ 200000), во второй — N целых чисел от -10^9 до 10^9. Выведите длину наибольшей строго возрастающей подпоследовательности.', 'hard')
)
INSERT INTO tasks(title, statement, time_limit_ms, memory_limit_kb, owner_id, difficulty)
SELECT seed.title, seed.statement, 2000, 262144, owner.id, seed.difficulty
FROM seed
JOIN users owner ON owner.username = 'demo-organizer'
WHERE NOT EXISTS (
    SELECT 1 FROM tasks existing
    WHERE existing.title = seed.title AND existing.owner_id = owner.id
);

WITH examples(title, input, output, hidden) AS (
    VALUES
        ('Палиндром числа', '12321', 'YES', false),
        ('Палиндром числа', '120', 'NO', true),
        ('Палиндром числа', '7', 'YES', true),
        ('Наибольшая сумма отрезка', E'5\n-2 1 -3 4 -1', '4', false),
        ('Наибольшая сумма отрезка', E'4\n-7 -2 -5 -3', '-2', true),
        ('Наибольшая сумма отрезка', E'6\n1 2 3 -10 4 5', '9', true),
        ('Длина наибольшей возрастающей подпоследовательности', E'8\n10 9 2 5 3 7 101 18', '4', false),
        ('Длина наибольшей возрастающей подпоследовательности', E'5\n5 4 3 2 1', '1', true),
        ('Длина наибольшей возрастающей подпоследовательности', E'6\n1 2 2 3 4 4', '4', true)
)
INSERT INTO task_tests(task_id, input, output, is_hidden)
SELECT task.id, examples.input, examples.output, examples.hidden
FROM examples
JOIN users owner ON owner.username = 'demo-organizer'
JOIN tasks task ON task.title = examples.title AND task.owner_id = owner.id
WHERE NOT EXISTS (
    SELECT 1 FROM task_tests existing
    WHERE existing.task_id = task.id
      AND existing.input = examples.input
      AND existing.output = examples.output
);

-- Repeatable local API scenario fixtures. Existing named records are reused.
INSERT INTO users(username, display_name, role, password_hash)
VALUES
 ('demo-participant-1', 'Демо участник 1', 'participant', 'pbkdf2$310000$00112233445566778899aabbccddeeff$c173d9734b99f01aa644bc65df415c7ab463ba035a42ae7a3336be50f461d7aa'),
 ('demo-participant-2', 'Демо участник 2', 'participant', 'pbkdf2$310000$00112233445566778899aabbccddeeff$c173d9734b99f01aa644bc65df415c7ab463ba035a42ae7a3336be50f461d7aa')
ON CONFLICT (username) DO NOTHING;

INSERT INTO tasks(title, statement, time_limit_ms, memory_limit_kb, owner_id)
SELECT fixture.title, fixture.statement, 1000, 65536, u.id
FROM (VALUES ('Демо: сумма двух чисел', 'Выведите сумму двух целых чисел.'),
             ('Демо: удвоение числа', 'Выведите удвоенное целое число.')) AS fixture(title, statement)
CROSS JOIN users u
WHERE u.username='demo-organizer'
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.title=fixture.title);

INSERT INTO task_tests(task_id,input,output,is_hidden)
SELECT t.id, fixture.input, fixture.output, fixture.hidden
FROM (VALUES ('Демо: сумма двух чисел','1 2','3',false),
             ('Демо: сумма двух чисел','-4 9','5',true),
             ('Демо: удвоение числа','3','6',false),
             ('Демо: удвоение числа','0','0',true)) AS fixture(title,input,output,hidden)
JOIN tasks t ON t.title=fixture.title
WHERE NOT EXISTS (SELECT 1 FROM task_tests tt WHERE tt.task_id=t.id AND tt.input=fixture.input);

INSERT INTO contests(title,description,starts_at,duration_minutes,organizer_id)
SELECT 'Демо-контест API', 'Локальный сценарий проверки API', now()-interval '1 hour', 100000, u.id
FROM users u WHERE u.username='demo-organizer'
AND NOT EXISTS (SELECT 1 FROM contests c WHERE c.title='Демо-контест API');

INSERT INTO contest_tasks(contest_id,task_id)
SELECT c.id,t.id FROM contests c CROSS JOIN tasks t
WHERE c.title='Демо-контест API' AND t.title IN ('Демо: сумма двух чисел','Демо: удвоение числа')
ON CONFLICT DO NOTHING;

INSERT INTO registrations(contest_id,user_id)
SELECT c.id,u.id FROM contests c CROSS JOIN users u
WHERE c.title='Демо-контест API' AND u.username IN ('demo-participant-1','demo-participant-2')
ON CONFLICT DO NOTHING;

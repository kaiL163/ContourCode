-- Only the named seed records are renamed; IDs and participant data are retained.
UPDATE users SET display_name = CASE username
    WHEN 'demo-organizer' THEN 'Ирина Климова'
    WHEN 'demo-participant-1' THEN 'Аня Морозова'
    WHEN 'demo-participant-2' THEN 'Марк Смирнов'
END
WHERE username IN ('demo-organizer', 'demo-participant-1', 'demo-participant-2')
  AND display_name IN ('Демо организатор', 'Демо участник 1', 'Демо участник 2');

UPDATE tasks SET title = CASE title
    WHEN 'Демо: сумма двух чисел' THEN 'Сумма двух чисел'
    WHEN 'Демо: удвоение числа' THEN 'Удвоение числа'
END
WHERE title IN ('Демо: сумма двух чисел', 'Демо: удвоение числа')
  AND owner_id = (SELECT id FROM users WHERE username = 'demo-organizer');

UPDATE contests
SET title = 'Алгоритмический раунд', description = 'Две задачи на работу с целыми числами.'
WHERE title = 'Демо-контест API'
  AND organizer_id = (SELECT id FROM users WHERE username = 'demo-organizer');

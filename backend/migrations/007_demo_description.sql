-- Update only the original demo contest description after adding verdict examples.
UPDATE contests
SET description = 'Задачи на целые числа и примеры для проверки вердиктов.'
WHERE title = 'Алгоритмический раунд'
  AND description = 'Две задачи на работу с целыми числами.'
  AND organizer_id = (SELECT id FROM users WHERE username = 'demo-organizer');

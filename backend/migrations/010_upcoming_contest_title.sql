-- Keep the seeded title independent of the weekday of the generated date.
UPDATE contests SET title='Раунд по основам'
WHERE title='Субботний раунд'
  AND description='Индивидуальный контест с задачами на основы программирования и работу с целыми числами.'
  AND organizer_id=(SELECT id FROM users WHERE username='demo-organizer');

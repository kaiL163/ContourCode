-- Idempotent local demo seed. The reserved username is safe to upsert on every environment.
INSERT INTO users(username, display_name, role, password_hash)
VALUES ('demo-organizer', 'Демо организатор', 'organizer', 'pbkdf2$310000$00112233445566778899aabbccddeeff$c173d9734b99f01aa644bc65df415c7ab463ba035a42ae7a3336be50f461d7aa')
ON CONFLICT (username) DO NOTHING;

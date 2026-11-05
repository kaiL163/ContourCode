# КонтурКод

КонтурКод — платформа для алгоритмических соревнований. В проект входят веб-интерфейс на React и TypeScript, API на FastAPI, PostgreSQL и Judge0 для проверки решений на C++17.

## Запуск

Нужны Docker Desktop и Docker Compose. Из корня проекта запустите:

```powershell
docker compose --env-file .env.example up --build -d
```

Откройте [http://localhost:8080](http://localhost:8080). API доступно по адресу `http://localhost:8080/api`.

Файл `.env.example` содержит только локальные демонстрационные параметры и исключён из Git. Если его нет после клонирования, создайте его в корне проекта со следующими значениями:

```dotenv
APP_DB_NAME=app
APP_DB_USER=app
APP_DB_PASSWORD=change-me-app-db
JWT_SECRET=change-me-long-random-signing-secret
JUDGE0_LANGUAGE_ID=54
FRONTEND_PORT=8080
REDIS_PASSWORD=change-me-judge0-redis
POSTGRES_HOST=judge0-db
POSTGRES_PORT=5432
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=change-me-judge0-db
```

Для остановки контейнеров используйте:

```powershell
docker compose --env-file .env.example down
```

Данные PostgreSQL хранятся в Docker volumes и сохраняются после остановки. Для полного сброса локальных данных используйте `docker compose --env-file .env.example down -v`.

## Демо-вход

| Роль | Имя пользователя | Пароль |
| --- | --- | --- |
| Участник | `demo-participant-1` | `demo123` |
| Участник | `demo-participant-2` | `demo123` |
| Организатор | `demo-organizer` | `demo123` |

На странице входа можно выбрать профиль, чтобы автоматически заполнить форму.

## Проверка решений

Решения отправляются из интерфейса в API и проверяются Judge0. Состояния отправок отражают результат проверки, включая принятое решение, неверный ответ, превышение времени, ошибку выполнения или компиляции.

Для локальной работы Judge0 настроен на Docker с поддержкой cgroups v2. Контейнеры Judge0 запускаются с повышенными привилегиями для изоляции процессов. Используйте проект только на локальной машине и не публикуйте его в интернете без отдельной проверки безопасности.

## Разработка frontend отдельно

```powershell
cd frontend
npm ci
npm run dev
```

Vite доступен на `http://localhost:5173`; запросы `/api` проксируются на backend `http://127.0.0.1:8080`.

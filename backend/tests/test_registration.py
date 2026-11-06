"""Registration checks against a rolled-back local database transaction."""

import os
import unittest
import uuid
from contextlib import contextmanager
from unittest.mock import patch

import psycopg
from fastapi.testclient import TestClient
from app import main


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.db = psycopg.connect(os.environ["DATABASE_URL"])

        @contextmanager
        def transaction():
            yield self.db

        self.connection_patch = patch.object(main, "connection", transaction)
        self.connection_patch.start()
        self.client = TestClient(main.app)
        self.username = "check_" + uuid.uuid4().hex[:12]

    def tearDown(self):
        self.client.close()
        self.connection_patch.stop()
        self.db.rollback()
        self.db.close()

    def test_registration_login_duplicate_and_role_rejection(self):
        body = {
            "username": self.username,
            "display_name": "Тестовый участник",
            "password": "test-password-2026",
        }
        response = self.client.post("/api/auth/register", json=body)
        self.assertEqual(response.status_code, 201)
        user = response.json()["user"]
        self.assertEqual(user["role"], "participant")
        encoded = self.db.execute(
            "SELECT password_hash FROM users WHERE id=%s", (user["id"],)
        ).fetchone()[0]
        self.assertNotIn(body["password"], encoded)
        self.assertTrue(encoded.startswith("pbkdf2$"))
        self.assertEqual(
            self.client.post(
                "/api/auth/login",
                json={"username": self.username, "password": body["password"]},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                "/api/auth/login",
                json={"username": self.username, "password": "not-the-password"},
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post("/api/auth/register", json=body).status_code, 409
        )
        self.assertEqual(
            self.client.post(
                "/api/auth/register",
                json={**body, "username": self.username + "x", "role": "organizer"},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/auth/register",
                json={**body, "username": self.username + "y", "password": "short"},
            ).status_code,
            422,
        )


if __name__ == "__main__":
    unittest.main()

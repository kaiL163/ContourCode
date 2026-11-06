"""Profile persistence and access checks, isolated in a rolled-back transaction."""

import os
import unittest
import uuid
from contextlib import contextmanager
from unittest.mock import patch

import psycopg
from fastapi.testclient import TestClient
from app import main


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.db = psycopg.connect(os.environ["DATABASE_URL"])

        @contextmanager
        def transaction():
            yield self.db

        self.connection_patch = patch.object(main, "connection", transaction)
        self.connection_patch.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.connection_patch.stop()
        self.db.rollback()
        self.db.close()

    def test_profile_updates_preserve_login_and_cannot_change_role(self):
        username = "profile_" + uuid.uuid4().hex[:12]
        signup = self.client.post(
            "/api/auth/register",
            json={
                "username": username,
                "display_name": "Проверка",
                "password": "test-password-2026",
            },
        )
        self.assertEqual(signup.status_code, 201)
        headers = {"Authorization": "Bearer " + signup.json()["access_token"]}
        avatar = "data:image/png;base64,iVBORw0KGgo="
        payload = {
            "display_name": "Новое имя",
            "avatar_image": avatar,
            "skills": ["C++", "графы", "c++"],
        }
        response = self.client.post("/api/profile", headers=headers, json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], username)
        self.assertEqual(response.json()["role"], "participant")
        self.assertEqual(response.json()["skills"], ["C++", "графы"])
        self.assertEqual(
            self.client.get("/api/auth/me", headers=headers).json()["avatar_image"],
            avatar,
        )
        self.assertEqual(
            self.client.post(
                "/api/profile", headers=headers, json={**payload, "username": "other"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/profile", headers=headers, json={**payload, "role": "organizer"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/profile",
                headers=headers,
                json={**payload, "avatar_image": "data:image/svg+xml;base64,PHN2Zz4="},
            ).status_code,
            422,
        )
        self.assertEqual(self.client.get("/api/profile").status_code, 401)


if __name__ == "__main__":
    unittest.main()

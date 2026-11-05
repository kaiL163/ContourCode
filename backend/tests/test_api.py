from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.main import _contest_finished, _score_match


def test_health():
    with TestClient(app) as client:
        assert client.get('/api/health').status_code == 200


def test_match_progress_counts_only_first_accepted_submission_per_task():
    submissions = [
        (4, 8, 'OK', 10), (4, 8, 'OK', 20), (4, 9, 'WA', 30),
        (7, 9, 'OK', 40),
    ]
    assert _score_match([4, 7], submissions) == [
        {'user_id': 4, 'solved': 1, 'elapsed_seconds': 10},
        {'user_id': 7, 'solved': 1, 'elapsed_seconds': 40},
    ]


def test_contest_finish_uses_timezone_aware_datetimes():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    assert _contest_finished(now - timedelta(minutes=1), 1, now)
    assert not _contest_finished(now + timedelta(minutes=1), 1, now)


def test_startup_migrations_and_demo_seed_are_idempotent():
    with TestClient(app) as client:
        for _ in range(2):
            response = client.post('/api/auth/login', json={
                'username': 'demo-organizer', 'password': 'demo123'
            })
            assert response.status_code == 200
            assert response.json()['user']['role'] == 'organizer'
        for username in ('demo-participant-1', 'demo-participant-2'):
            assert client.post('/api/auth/login', json={'username': username, 'password': 'demo123'}).status_code == 200


def test_demo_scenario_logins_and_relations_exist_through_api():
    with TestClient(app) as client:
        tokens = {}
        for username, role in [('demo-organizer', 'organizer'),
                               ('demo-participant-1', 'participant'),
                               ('demo-participant-2', 'participant')]:
            login = client.post('/api/auth/login', json={'username': username, 'password': 'demo123'})
            assert login.status_code == 200
            assert login.json()['user']['role'] == role
            tokens[username] = login.json()['access_token']

        organizer = {'Authorization': f"Bearer {tokens['demo-organizer']}"}
        p1 = {'Authorization': f"Bearer {tokens['demo-participant-1']}"}
        p2 = {'Authorization': f"Bearer {tokens['demo-participant-2']}"}
        contests = client.get('/api/contests', headers=p1)
        assert contests.status_code == 200
        contest = next(c for c in contests.json() if c['title'] == 'Алгоритмический раунд')
        assert len(contest['task_ids']) >= 2
        assert contest['registered'] is True
        detail = client.get(f"/api/contests/{contest['id']}", headers=p2)
        assert detail.status_code == 200 and detail.json()['registered'] is True
        tasks = client.get('/api/tasks', headers=organizer)
        assert any(t['id'] in contest['task_ids'] for t in tasks.json())
        assert client.get(f"/api/contests/{contest['id']}/integrity/submissions", headers=p1).status_code == 403

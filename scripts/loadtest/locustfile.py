"""
Load test for citizen report submission (see scripts/loadtest/README.md).

Each simulated citizen submits a report, then polls its status a few times,
the way the web app does after submitting.
"""

from __future__ import annotations

import random

from locust import HttpUser, between, task

# Default CITY_BBOX: (south, west, north, east).
SOUTH, WEST, NORTH, EAST = -1.45, 36.65, -1.16, 37.10

DESCRIPTIONS = [
    "Deep pothole in the left lane, cars are swerving around it",
    "Water leak from a burst pipe flooding the pavement",
    "Power outage on the whole street since this morning",
    "Broken streetlight at the junction, very dark at night",
    "Sewage overflowing from a manhole near the market",
    "Road surface cracked and sinking after the rains",
    "Exposed wire hanging from a pole next to the school",
    "Smell of gas near the roundabout, people are worried",
]


class Citizen(HttpUser):
    wait_time = between(0.5, 2.0)

    def on_start(self) -> None:
        # A distinct client address, so per-client rate limiting sees many
        # citizens rather than one machine (TRUSTED_PROXY_HOPS=0 reads the
        # last X-Forwarded-For entry).
        self.ip = f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"
        self.report_ids: list[str] = []

    @task(1)
    def submit_report(self) -> None:
        body = {
            "description": random.choice(DESCRIPTIONS),
            "location": {"lat": random.uniform(SOUTH, NORTH), "lng": random.uniform(WEST, EAST)},
            "captcha_token": "load-test",
        }
        with self.client.post(
            "/api/reports",
            json=body,
            headers={"X-Forwarded-For": self.ip},
            name="POST /api/reports",
            catch_response=True,
        ) as response:
            if response.status_code == 202:
                self.report_ids.append(response.json()["report_id"])
            else:
                response.failure(f"{response.status_code}: {response.text[:200]}")

    @task(3)
    def check_status(self) -> None:
        if not self.report_ids:
            return
        report_id = random.choice(self.report_ids[-5:])
        self.client.get(f"/api/reports/{report_id}", name="GET /api/reports/{id}")

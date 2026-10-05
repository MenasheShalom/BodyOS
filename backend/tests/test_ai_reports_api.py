from typing import Any

import psycopg
import pytest

from app.ai.fake import FakeProvider
from app.ai.prompts.weekly_report import (
    ReportOut,
    Section,
    allowed_numbers,
    template_report,
    unsupported_numbers,
)
from app.ai.provider import AIResult, AIUsage
from tests.conftest import auth_for
from tests.test_insight_api import PROFILE, add_target, seed

WEEK = "2026-03-01"  # FIXED_NOW's local date: a Sunday, the default check-in day


@pytest.fixture
def setup(client, headers, user, db) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    seed(db, user, days=14, kcal=2100)
    add_target(db, user, "2026-02-01", 2200, protein=160)


def generate(client, headers, week: str = WEEK) -> Any:
    return client.post(f"/ai/reports/{week}", headers=headers)


def test_report_written_from_computed_facts(client, headers, user, db, ai, setup) -> None:
    assert client.get("/ai/reports", headers=headers).json() == {
        "current_week_start": WEEK,
        "reports": [],
    }
    assert client.get(f"/ai/reports/{WEEK}", headers=headers).status_code == 404

    res = generate(client, headers)
    assert res.status_code == 200, res.text
    report = res.json()
    assert report["fallback"] is False and report["can_regenerate"] is True
    assert report["summary"].startswith("A steady week")
    assert [s["tone"] for s in report["sections"]] == ["good", "neutral"]

    facts = report["facts"]
    assert facts["week"] == {"from": "2026-02-23", "to": WEEK}
    assert facts["food"]["days_logged"] == 7
    assert facts["food"]["avg_kcal"] == 2100
    assert facts["food"]["target_kcal"] == 2200
    assert facts["food"]["protein_target_days_hit"] == 7  # 150 g ≥ 90% of 160 g
    assert facts["previous_week_food"]["days_logged"] == 7
    assert facts["weigh_ins"] == 7
    weight = facts["body"]["weight_kg"]
    assert weight["now"] < weight["week_ago"] and weight["change"] < 0

    sent = report_request()
    assert "<facts>" in sent.text and '"avg_kcal": 2100' in sent.text

    listed = client.get("/ai/reports", headers=headers).json()["reports"]
    assert listed == [{"week_start": WEEK, "summary": report["summary"], "fallback": False}]
    assert client.get(f"/ai/reports/{WEEK}", headers=headers).json()["facts"] == facts


def report_request() -> Any:
    from app.ai.factory import _build

    return _build("fake", None, "medium", 60, None, None).requests[-1]  # type: ignore[attr-defined]


def test_rewrite_once_per_week(client, headers, ai, setup) -> None:
    generate(client, headers)
    again = generate(client, headers)
    assert again.status_code == 200 and again.json()["can_regenerate"] is False
    assert generate(client, headers).status_code == 409


@pytest.mark.parametrize("week", ["2026-02-28", "2026-03-08", "2025-02-23"])
def test_only_past_check_in_days(client, headers, ai, setup, week: str) -> None:
    assert generate(client, headers, week).status_code == 422


def test_made_up_numbers_fall_back_to_template(
    client, headers, user, db, ai, setup, monkeypatch
) -> None:
    invented = ReportOut(
        summary="You ate 2,999 kcal a day.",
        sections=[
            Section(title="Body", body="Down 3.7 kg.", tone="good"),
            Section(title="Eating", body="Fine.", tone="neutral"),
        ],
        focus=["Keep going."],
    )

    def fake_generate(self: FakeProvider, request: Any) -> Any:
        return AIResult(invented, AIUsage(), "fake-1", 1)

    monkeypatch.setattr(FakeProvider, "generate", fake_generate)
    report = generate(client, headers).json()
    assert report["fallback"] is True
    assert report["summary"].startswith("Week to 1 March: 7 of 7 days logged.")
    with psycopg.connect(db) as conn:
        rows = conn.execute("select outcome from ai_usage where user_id = %s", (user,)).fetchall()
    assert rows == [("ok",), ("ok",)]  # retried once before falling back


def test_reports_are_private(client, headers, make_user, ai, setup) -> None:
    generate(client, headers)
    other = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=other)
    assert client.get(f"/ai/reports/{WEEK}", headers=other).status_code == 404
    assert client.get("/ai/reports", headers=other).json()["reports"] == []


# --- the number check -----------------------------------------------------------------------

FACTS = {
    "week": {"from": "2026-02-23", "to": "2026-03-01"},
    "body": {
        "weight_kg": {
            "label": "Weight",
            "unit": "kg",
            "now": 84.3,
            "change": -0.35,
            "rate_per_week": -0.35,
        }
    },
    "food": {"days_logged": 6, "avg_kcal": 2150, "target_kcal": 2200},
    "goals": [{"goal": "Body fat", "target": 15, "projected_date": "2026-06-14"}],
}


def _report(text: str) -> ReportOut:
    return ReportOut(
        summary=text,
        sections=[
            Section(title="A", body="b", tone="good"),
            Section(title="C", body="d", tone="good"),
        ],
        focus=["e"],
    )


@pytest.mark.parametrize(
    "text",
    [
        "Weight trend 84.3 kg, down 0.35 kg; 6 of 7 days logged at 2,150 kcal vs 2200.",
        "On track for 15% by June 14, 2026.",
        "Down 0.4 kg this week.",  # 0.35 rounded
    ],
)
def test_numbers_from_the_facts_pass(text: str) -> None:
    assert unsupported_numbers(_report(text), FACTS) == []


def test_invented_numbers_are_caught() -> None:
    assert unsupported_numbers(_report("That's 98% of target and 2,300 kcal."), FACTS) == [
        "98",
        "2300",
    ]


def test_allowed_numbers_include_rounding_and_dates() -> None:
    allowed = allowed_numbers(FACTS)
    assert {"84.3", "84", "0.35", "0.4", "2150", "14", "6", "2026"} <= allowed


def test_template_report_uses_only_facts() -> None:
    report = template_report(FACTS | {"weigh_ins": 5})
    assert unsupported_numbers(report, FACTS | {"weigh_ins": 5}) == []
    assert report.summary == "Week to 1 March: 6 of 7 days logged. Weight trend 84.3 kg."

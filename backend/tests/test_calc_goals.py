from datetime import date

from app.calculations.goals import project_goal

TODAY = date(2026, 3, 1)


def test_on_track_projects_date_and_progress() -> None:
    p = project_goal(20, 15, 18, -0.5, TODAY, flat_threshold=0.05)
    assert p.state == "on_track"
    assert p.progress_pct == 40.0
    assert p.projected_date == date(2026, 4, 12)  # 4 kg / 0.5 per week = 6 weeks = 42 days


def test_upward_goal_on_track() -> None:
    p = project_goal(60, 64, 61, 0.25, TODAY, flat_threshold=0.05)
    assert p.state == "on_track"
    assert p.progress_pct == 25.0
    assert p.projected_date == date(2026, 5, 24)  # 3 / 0.25 = 12 weeks


def test_reached_even_without_rate() -> None:
    p = project_goal(20, 15, 14.8, None, TODAY, flat_threshold=0.05)
    assert p.state == "reached"
    assert p.progress_pct == 100.0
    assert p.projected_date is None


def test_no_current_value() -> None:
    p = project_goal(20, 15, None, None, TODAY, flat_threshold=0.05)
    assert p.state == "insufficient_data"
    assert p.progress_pct is None


def test_no_rate_is_insufficient_but_keeps_progress() -> None:
    p = project_goal(20, 15, 19, None, TODAY, flat_threshold=0.05)
    assert p.state == "insufficient_data"
    assert p.progress_pct == 20.0


def test_moving_away_is_not_on_pace() -> None:
    p = project_goal(20, 15, 19, 0.3, TODAY, flat_threshold=0.05)
    assert p.state == "not_on_pace"
    assert p.projected_date is None


def test_flat_is_not_on_pace() -> None:
    p = project_goal(20, 15, 19, -0.01, TODAY, flat_threshold=0.05)
    assert p.state == "not_on_pace"


def test_beyond_two_years_is_not_on_pace() -> None:
    p = project_goal(20, 10, 19, -0.06, TODAY, flat_threshold=0.05)  # 150 weeks
    assert p.state == "not_on_pace"


def test_progress_clamped_when_going_backwards() -> None:
    p = project_goal(20, 15, 21, 0.2, TODAY, flat_threshold=0.05)
    assert p.progress_pct == 0.0

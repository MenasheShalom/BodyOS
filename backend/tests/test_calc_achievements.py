from datetime import date, timedelta

from app.calculations.achievements import (
    Outcome,
    crossed,
    drop_from_peak,
    in_window,
    nth,
    streak,
    week_streak,
)
from app.calculations.series import Point

D = date(2026, 1, 1)


def days(*offsets: int) -> list[date]:
    return [D + timedelta(days=o) for o in offsets]


def test_nth() -> None:
    assert nth(days(0, 0, 3), 2) == Outcome(D, 2)
    assert nth(days(0), 3) == Outcome(None, 1)
    assert nth([], 1) == Outcome(None, 0)


def test_streak_finds_first_run_and_best() -> None:
    # 3-day run, gap, 5-day run
    seen = days(0, 1, 2, 5, 6, 7, 8, 9, 9)
    assert streak(seen, 5) == Outcome(D + timedelta(days=9), 5)
    assert streak(seen, 7) == Outcome(None, 5)
    assert streak(days(4, 1, 2, 3), 4) == Outcome(D + timedelta(days=4), 4)  # unsorted input


def test_week_streak() -> None:
    # Jan 1 2026 is a Thursday: weeks of Dec 29, Jan 5, Jan 12; then a missed week
    seen = days(0, 6, 13, 27)
    assert week_streak(seen, 3) == Outcome(D + timedelta(days=13), 3)
    assert week_streak(seen, 4) == Outcome(None, 3)


def test_in_window() -> None:
    assert in_window(days(0, 2, 4, 6, 8), 4) == Outcome(D + timedelta(days=6), 4)
    assert in_window(days(0, 3, 7, 10), 3) == Outcome(None, 2)


def pts(*values: float) -> list[Point]:
    return [Point(D + timedelta(days=i), v) for i, v in enumerate(values)]


def test_drop_from_peak_uses_running_peak() -> None:
    trend = pts(80, 81, 80.4, 79.9, 80.5)
    assert drop_from_peak(trend, 1) == Outcome(D + timedelta(days=3), 1)
    assert drop_from_peak(trend, 2) == Outcome(None, 1.1)
    assert drop_from_peak([], 1) == Outcome(None, 0)


def test_crossed_respects_direction_and_start() -> None:
    trend = pts(80, 79, 78, 77)
    assert crossed(trend, D, 80, 78) == D + timedelta(days=2)
    assert crossed(trend, D + timedelta(days=3), 80, 78) == D + timedelta(days=3)
    assert crossed(trend, D, 80, 76) is None
    assert crossed(pts(20, 21, 22), D, 20, 21.5) == D + timedelta(days=2)  # upward goal

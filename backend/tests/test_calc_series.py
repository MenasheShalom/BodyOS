from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.calculations.series import (
    Point,
    change,
    daily_means,
    ewma_trend,
    weekly_last,
    weekly_means,
    weekly_rate,
)

JERUSALEM = ZoneInfo("Asia/Jerusalem")


def test_daily_means_uses_local_day() -> None:
    # 23:30 UTC on Jan 1 is 01:30 on Jan 2 in Jerusalem (UTC+2)
    readings = [
        (datetime(2026, 1, 1, 23, 30, tzinfo=UTC), 80.0),
        (datetime(2026, 1, 2, 6, 0, tzinfo=UTC), 81.0),
        (datetime(2026, 1, 1, 8, 0, tzinfo=UTC), 79.0),
    ]
    assert daily_means(readings, JERUSALEM) == [
        Point(date(2026, 1, 1), 79.0),
        Point(date(2026, 1, 2), 80.5),
    ]


def test_daily_means_empty() -> None:
    assert daily_means([], JERUSALEM) == []


def test_ewma_consecutive_days() -> None:
    pts = [Point(date(2026, 1, 1), 100.0), Point(date(2026, 1, 2), 90.0)]
    trend = ewma_trend(pts, alpha=0.1)
    assert trend[0].value == 100.0
    assert trend[1].value == pytest.approx(99.0)


def test_ewma_gap_gives_more_weight() -> None:
    pts = [Point(date(2026, 1, 1), 100.0), Point(date(2026, 1, 6), 90.0)]
    trend = ewma_trend(pts, alpha=0.1)
    # a = 1 - 0.9**5 = 0.40951
    assert trend[1].value == pytest.approx(95.9049, abs=1e-4)


def test_ewma_single_and_empty() -> None:
    assert ewma_trend([], 0.1) == []
    assert ewma_trend([Point(date(2026, 1, 1), 70.0)], 0.1) == [Point(date(2026, 1, 1), 70.0)]


def _line(start: date, days: int, first: float, per_day: float) -> list[Point]:
    return [Point(start + timedelta(days=i), first + per_day * i) for i in range(days)]


def test_weekly_rate_linear() -> None:
    today = date(2026, 3, 1)
    trend = _line(today - timedelta(days=20), 21, 80.0, -0.1)
    assert weekly_rate(trend, today) == pytest.approx(-0.7)


def test_weekly_rate_ignores_points_older_than_window() -> None:
    today = date(2026, 3, 1)
    old = _line(today - timedelta(days=100), 10, 50.0, 5.0)  # steep, old
    recent = _line(today - timedelta(days=20), 21, 80.0, -0.1)
    assert weekly_rate(old + recent, today) == pytest.approx(-0.7)


def test_weekly_rate_needs_four_points() -> None:
    today = date(2026, 3, 1)
    trend = [Point(today - timedelta(days=d), 80.0) for d in (20, 10, 0)]
    assert weekly_rate(trend, today) is None


def test_weekly_rate_needs_fourteen_day_span() -> None:
    today = date(2026, 3, 1)
    trend = _line(today - timedelta(days=9), 10, 80.0, -0.1)
    assert weekly_rate(trend, today) is None


def test_change() -> None:
    assert change([]) is None
    assert change([Point(date(2026, 1, 1), 5.0)]) is None
    assert change([Point(date(2026, 1, 1), 5.0), Point(date(2026, 1, 9), 3.5)]) == -1.5


def test_weekly_means_and_last() -> None:
    # 2026-01-05 is a Monday
    pts = [
        Point(date(2026, 1, 5), 10.0),
        Point(date(2026, 1, 7), 20.0),
        Point(date(2026, 1, 12), 30.0),
    ]
    assert weekly_means(pts) == [Point(date(2026, 1, 5), 15.0), Point(date(2026, 1, 12), 30.0)]
    assert weekly_last(pts) == [Point(date(2026, 1, 5), 20.0), Point(date(2026, 1, 12), 30.0)]

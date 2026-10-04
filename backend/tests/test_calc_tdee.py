import random
import statistics
from datetime import date, timedelta

import pytest

from app.calculations.series import Point
from app.calculations.tdee import (
    adaptive_tdee,
    check_in_days,
    eligible_days,
    observe,
)

START = date(2026, 1, 5)  # a Monday
SUNDAY = 6
TRUE_TDEE = 2500
SEED_GUESS = 2100  # deliberately 400 kcal off


def simulate(seed: int, weeks: int = 10, spike_day: int | None = None, weigh_every: int = 1):
    """Daily intake around 2,200 kcal against a true burn of 2,500, with the scale reading
    the energy-balance weight plus up to ±0.6 kg of water."""
    rng = random.Random(seed)
    weight = 85.0
    intake: dict[date, float] = {}
    readings: list[Point] = []
    for i in range(weeks * 7):
        day = START + timedelta(days=i)
        kcal = 2200 + rng.uniform(-300, 300)
        intake[day] = kcal
        weight += (kcal - TRUE_TDEE) / 7700
        water = rng.uniform(-0.6, 0.6) + (2.0 if i == spike_day else 0.0)
        if i % weigh_every == 0:
            readings.append(Point(day, weight + water))
    today = START + timedelta(days=weeks * 7 - 1)
    return adaptive_tdee(intake, readings, SEED_GUESS, today, SUNDAY)


def test_recovers_a_known_tdee() -> None:
    runs = [simulate(seed) for seed in range(20)]
    week6 = [abs(r.weekly[5].smoothed - TRUE_TDEE) for r in runs]
    week8 = [abs(r.weekly[7].smoothed - TRUE_TDEE) for r in runs]
    week3 = [abs(r.weekly[2].smoothed - TRUE_TDEE) for r in runs]
    assert statistics.median(week8) <= 50
    assert max(week8) <= 150
    assert statistics.median(week6) <= 75
    assert statistics.mean(week8) < statistics.mean(week3) / 2  # it keeps closing the gap
    assert all(r.has_data for r in runs)


def test_one_day_water_spike_barely_moves_it() -> None:
    for seed in range(10):
        calm, spiked = simulate(seed), simulate(seed, spike_day=30)
        moved = max(
            abs(a.smoothed - b.smoothed) for a, b in zip(calm.weekly, spiked.weekly, strict=True)
        )
        assert moved < 75


def test_works_with_weigh_ins_every_other_day() -> None:
    runs = [simulate(seed, weigh_every=2) for seed in range(10)]
    assert statistics.median(abs(r.current - TRUE_TDEE) for r in runs) <= 75


def test_needs_fourteen_logged_days() -> None:
    intake = {START + timedelta(days=i): 2200.0 for i in range(13)}
    trend = [Point(START + timedelta(days=i), 85 - i * 0.04) for i in range(13)]
    r = adaptive_tdee(intake, trend, SEED_GUESS, START + timedelta(days=13), SUNDAY)
    assert not r.has_data and r.current == SEED_GUESS and r.confidence is None
    assert r.eligible_days_now == 13


def test_no_food_logged_yet() -> None:
    r = adaptive_tdee({}, [], SEED_GUESS, START, SUNDAY)
    assert r.weekly == [] and r.current == SEED_GUESS and not r.has_data


def test_observation_needs_enough_weigh_ins_over_two_weeks() -> None:
    end = START + timedelta(days=27)
    intake = {START + timedelta(days=i): 2200.0 for i in range(28)}
    few = [Point(START + timedelta(days=i), 85.0) for i in range(0, 28, 4)]  # 7 weigh-ins
    assert observe(end, intake, few, few) is None
    short = [Point(START + timedelta(days=i), 85.0) for i in range(18, 28)]  # 9 days apart
    assert observe(end, intake, short, short) is None
    steady = [Point(START + timedelta(days=i), 85.0) for i in range(28)]
    obs = observe(end, intake, steady, steady)
    assert obs is not None and obs.tdee == pytest.approx(2200)  # weight flat: burn = intake


def test_losing_weight_means_burning_more_than_eaten() -> None:
    end = START + timedelta(days=27)
    intake = {START + timedelta(days=i): 2000.0 for i in range(28)}
    trend = [Point(START + timedelta(days=i), 85 - i * 0.05) for i in range(28)]  # −0.35 kg/wk
    obs = observe(end, intake, trend, trend)
    assert obs is not None
    assert obs.tdee == pytest.approx(2000 + 0.05 * 7700)
    assert obs.weight_change_kg == pytest.approx(-1.4)


def test_eligible_days_skip_flagged_and_half_logged() -> None:
    d1, d2, d3 = START, START + timedelta(days=1), START + timedelta(days=2)
    days = eligible_days({d1: 2100, d2: 900, d3: 2300}, {d3}, lambda _: 2000)
    assert days == {d1: 2100}


def test_first_weeks_use_daily_weights_not_the_lagging_trend() -> None:
    """A steady 0.05 kg/day loss from the first weigh-in: the trend hasn't caught up yet, so the
    reading must come from the weights themselves (burn = 2,000 + 0.05 × 7,700 = 2,385)."""
    days = [START + timedelta(days=i) for i in range(28)]
    intake = {d: 2000.0 for d in days}
    weights = [Point(d, 85 - 0.05 * i) for i, d in enumerate(days)]
    r = adaptive_tdee(intake, weights, 2385, days[-1], days[-1].weekday())
    assert r.weekly[-1].observed == pytest.approx(2385)


def test_check_in_days() -> None:
    assert check_in_days(START, START + timedelta(days=20), SUNDAY) == [
        date(2026, 1, 11),
        date(2026, 1, 18),
        date(2026, 1, 25),
    ]
    assert check_in_days(date(2026, 1, 11), date(2026, 1, 11), SUNDAY) == [date(2026, 1, 11)]


def test_confidence_after_four_observations() -> None:
    r = simulate(1)
    assert r.confidence is not None and 0 < r.confidence < 150
    assert [w.day.weekday() for w in r.weekly] == [SUNDAY] * len(r.weekly)

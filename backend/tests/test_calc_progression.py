from app.calculations.progression import DoneSet, Spec, Suggestion, increment, suggest

BENCH = Spec("reps", 3, 8, 12, None, True)
PUSH_UP = Spec("reps", 3, 6, 15, None, False)
PLANK = Spec("time", 2, None, None, 40, False)


def sets(*pairs: tuple[float | None, int]) -> list[DoneSet]:
    return [DoneSet(w, r, None) for w, r in pairs]


def test_first_time_starts_at_bottom_of_range() -> None:
    first = suggest(BENCH, [])
    assert (first.weight_kg, first.reps) == (None, 8)
    assert "about 14 times" in first.note
    assert suggest(PUSH_UP, []) == Suggestion(None, 6, None, "")


def test_adds_a_rep_until_the_top_then_weight() -> None:
    assert suggest(BENCH, sets((40, 10), (40, 9), (40, 8))) == Suggestion(
        40, 9, None, "Same weight, one more rep"
    )
    up = suggest(BENCH, sets((40, 12), (40, 12), (40, 13)))
    assert (up.weight_kg, up.reps) == (42.5, 8)
    # light weights go up by 1 kg
    assert suggest(BENCH, sets((10, 12), (10, 12), (10, 12))).weight_kg == 11
    # all reps at the top but a set missing: not yet
    assert suggest(BENCH, sets((40, 12), (40, 12))).weight_kg == 40


def test_uses_the_heaviest_weight_and_skips_empty_sets() -> None:
    s = suggest(BENCH, [*sets((40, 10), (42.5, 9)), DoneSet(42.5, 0, None)])
    assert (s.weight_kg, s.reps) == (42.5, 10)


def test_bodyweight() -> None:
    assert suggest(PUSH_UP, sets((None, 10), (None, 8), (None, 7))).reps == 8
    top = suggest(PUSH_UP, sets((None, 15), (None, 15), (None, 16)))
    assert top.reps == 15 and "harder variation" in top.note


def test_timed() -> None:
    assert suggest(PLANK, []).seconds == 40
    assert suggest(PLANK, [DoneSet(None, None, 40), DoneSet(None, None, 45)]).seconds == 45
    assert suggest(PLANK, [DoneSet(None, None, 40), DoneSet(None, None, 30)]).seconds == 40


def test_increment() -> None:
    assert (increment(19.9), increment(20)) == (1.0, 2.5)

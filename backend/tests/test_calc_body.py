import pytest

from app.calculations.body import bmi, fat_mass_kg, lean_mass_kg, navy_body_fat_pct


def test_bmi() -> None:
    assert bmi(80, 180) == 24.7


def test_fat_and_lean_mass() -> None:
    assert fat_mass_kg(80, 20) == 16.0
    assert lean_mass_kg(80, 20) == 64.0
    assert fat_mass_kg(82.4, 18.3) == 15.08
    assert lean_mass_kg(82.4, 18.3) == 67.32


def test_navy_male_reference() -> None:
    # 180 cm, waist 85, neck 38 -> ~16.1 %
    assert navy_body_fat_pct("male", 180, 85, 38) == pytest.approx(16.1, abs=0.15)


def test_navy_female_reference() -> None:
    # 165 cm, waist 70, hips 95, neck 32 -> ~24.9 %
    assert navy_body_fat_pct("female", 165, 70, 32, hips_cm=95) == pytest.approx(24.9, abs=0.15)


def test_navy_female_requires_hips() -> None:
    assert navy_body_fat_pct("female", 165, 70, 32) is None


def test_navy_invalid_geometry_returns_none() -> None:
    assert navy_body_fat_pct("male", 180, 38, 40) is None  # waist <= neck


def test_navy_out_of_range_result_returns_none() -> None:
    # Absurd waist produces > 70 %
    assert navy_body_fat_pct("male", 150, 240, 30) is None

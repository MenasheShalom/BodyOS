from datetime import date
from typing import Literal
from zoneinfo import available_timezones

from pydantic import BaseModel, Field, field_validator

OPTIONAL_SCALE_FIELDS: tuple[str, ...] = (
    "body_fat_pct",
    "muscle_mass_kg",
    "skeletal_muscle_pct",
    "body_water_pct",
    "bone_mass_kg",
    "visceral_fat",
    "protein_pct",
    "bmr_kcal",
    "metabolic_age",
)
HiddenMetric = Literal[
    "body_fat_pct",
    "muscle_mass_kg",
    "skeletal_muscle_pct",
    "body_water_pct",
    "bone_mass_kg",
    "visceral_fat",
    "protein_pct",
    "bmr_kcal",
    "metabolic_age",
]
_TIMEZONES = available_timezones()


class ProfileIn(BaseModel):
    height_cm: float = Field(ge=100, le=250)
    sex: Literal["male", "female"]
    date_of_birth: date
    timezone: str
    hidden_metrics: list[HiddenMetric] = []

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str) -> str:
        if value not in _TIMEZONES:
            raise ValueError("Unknown timezone")
        return value

    @field_validator("date_of_birth")
    @classmethod
    def _past_date(cls, value: date) -> date:
        if value >= date.today():
            raise ValueError("Date of birth must be in the past")
        return value


class ProfileOut(ProfileIn):
    pass

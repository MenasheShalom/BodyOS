from datetime import date, datetime, timedelta
from typing import Literal, Self
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator

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


FUTURE_SLACK = timedelta(minutes=10)


def validate_not_future(value: datetime, now: datetime) -> None:
    """Raise ValueError if `value` is in the future (with a small clock-skew allowance)."""
    if value > now + FUTURE_SLACK:
        raise ValueError("Date can't be in the future")


class BodyEntryBase(BaseModel):
    body_fat_pct: float | None = Field(default=None, ge=2, le=70)
    muscle_mass_kg: float | None = Field(default=None, ge=5, le=200)
    skeletal_muscle_pct: float | None = Field(default=None, ge=5, le=80)
    body_water_pct: float | None = Field(default=None, ge=20, le=80)
    bone_mass_kg: float | None = Field(default=None, ge=0.5, le=10)
    visceral_fat: float | None = Field(default=None, ge=1, le=60)
    protein_pct: float | None = Field(default=None, ge=5, le=30)
    bmr_kcal: int | None = Field(default=None, ge=500, le=5000)
    metabolic_age: int | None = Field(default=None, ge=10, le=100)
    note: str | None = Field(default=None, max_length=500)


class BodyEntryIn(BodyEntryBase):
    measured_at: AwareDatetime
    weight_kg: float = Field(ge=20, le=400)


class BodyEntryPatch(BodyEntryBase):
    measured_at: AwareDatetime | None = None
    weight_kg: float | None = Field(default=None, ge=20, le=400)

    @model_validator(mode="after")
    def _required_not_null(self) -> Self:
        for name in ("measured_at", "weight_kg"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be empty")
        return self


class BodyEntryOut(BodyEntryIn):
    id: UUID


MEASUREMENT_FIELDS: tuple[str, ...] = (
    "waist_cm",
    "hips_cm",
    "chest_cm",
    "neck_cm",
    "arm_cm",
    "thigh_cm",
)


class MeasurementBase(BaseModel):
    waist_cm: float | None = Field(default=None, ge=10, le=250)
    hips_cm: float | None = Field(default=None, ge=10, le=250)
    chest_cm: float | None = Field(default=None, ge=10, le=250)
    neck_cm: float | None = Field(default=None, ge=10, le=250)
    arm_cm: float | None = Field(default=None, ge=10, le=250)
    thigh_cm: float | None = Field(default=None, ge=10, le=250)
    note: str | None = Field(default=None, max_length=500)


class MeasurementIn(MeasurementBase):
    measured_at: AwareDatetime

    @model_validator(mode="after")
    def _at_least_one(self) -> Self:
        if all(getattr(self, f) is None for f in MEASUREMENT_FIELDS):
            raise ValueError("Enter at least one measurement")
        return self


class MeasurementPatch(MeasurementBase):
    measured_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _measured_at_not_null(self) -> Self:
        if "measured_at" in self.model_fields_set and self.measured_at is None:
            raise ValueError("measured_at can't be empty")
        return self


class MeasurementOut(MeasurementIn):
    id: UUID
    navy_body_fat_pct: float | None = None


class NavyPreview(BaseModel):
    navy_body_fat_pct: float | None

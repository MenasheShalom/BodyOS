from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.workouts.equipment import EQUIPMENT

Experience = Literal["new", "some", "experienced"]
Cardio = Literal["none", "light", "moderate"]
Kind = Literal["reps", "time"]


class LocationIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    equipment: list[str] = Field(default=[], max_length=len(EQUIPMENT))
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""

    @field_validator("equipment")
    @classmethod
    def _known(cls, value: list[str]) -> list[str]:
        unknown = [e for e in value if e not in EQUIPMENT]
        if unknown:
            raise ValueError(f"Unknown equipment: {', '.join(unknown)}")
        return [e for e in EQUIPMENT if e in value]  # deduped, in catalogue order


class LocationOut(LocationIn):
    id: UUID


class EquipmentOut(BaseModel):
    key: str
    label: str


class TrainingProfileIn(BaseModel):
    experience: Experience = "some"
    limitations: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
    days_per_week: int = Field(default=3, ge=2, le=6)
    session_minutes: int = Field(default=60, ge=20, le=120)
    cardio: Cardio = "light"


class TrainingProfileOut(TrainingProfileIn):
    configured: bool


class GenerateIn(BaseModel):
    location_ids: list[UUID] = Field(min_length=1, max_length=4)


class ExerciseOut(BaseModel):
    id: UUID
    position: int
    name: str
    kind: Kind
    sets: int
    reps_low: int | None
    reps_high: int | None
    seconds: int | None
    rest_seconds: int
    uses_weight: bool
    notes: str
    alternatives: list[str]


class ProgramDayOut(BaseModel):
    id: UUID
    position: int
    name: str
    focus: str
    location_id: UUID | None
    location_name: str | None
    cardio: str
    exercises: list[ExerciseOut]


class ProgramOut(BaseModel):
    id: UUID
    name: str
    summary: str
    weeks: int
    daily_steps: int | None
    started_on: date
    days: list[ProgramDayOut]
    created_at: datetime


class DayPatch(BaseModel):
    location_id: UUID | None


class SwapIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class SuggestionOut(BaseModel):
    weight_kg: float | None
    reps: int | None
    seconds: int | None
    note: str


class SetOut(BaseModel):
    exercise_id: UUID | None
    exercise_name: str
    set_number: int
    weight_kg: float | None
    reps: int | None
    seconds: int | None


class SessionOut(BaseModel):
    id: UUID
    program_day_id: UUID | None
    day_name: str
    performed_on: date
    completed_at: datetime | None
    notes: str
    sets: list[SetOut]


class TodayExerciseOut(BaseModel):
    exercise: ExerciseOut
    suggestion: SuggestionOut
    last: list[SetOut]  # the sets done the last time, for reference


class TodayOut(BaseModel):
    day: ProgramDayOut
    week: int  # program week this falls in, from 1
    session: SessionOut | None  # today's session if one is under way
    exercises: list[TodayExerciseOut]
    sessions_done: int


class SessionIn(BaseModel):
    program_day_id: UUID


class SetIn(BaseModel):
    exercise_id: UUID | None = None
    exercise_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]
    set_number: int = Field(ge=1, le=20)
    weight_kg: float | None = Field(default=None, ge=0, le=500)
    reps: int | None = Field(default=None, ge=0, le=200)
    seconds: int | None = Field(default=None, ge=0, le=3600)


class SetsIn(BaseModel):
    sets: list[SetIn] = Field(max_length=150)
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


class SessionSummaryOut(BaseModel):
    id: UUID
    day_name: str
    performed_on: date
    completed_at: datetime | None
    sets_done: int
    volume_kg: float  # sum of weight × reps

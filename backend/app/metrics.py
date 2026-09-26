from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from psycopg import sql

from app.calculations.body import bmi, fat_mass_kg, lean_mass_kg
from app.db import Conn
from app.profiles import Profile
from app.routers.measurements import navy_for
from app.schemas import MEASUREMENT_FIELDS, OPTIONAL_SCALE_FIELDS

Source = Literal["body", "measurement"]
Readings = list[tuple[datetime, float]]


@dataclass(frozen=True)
class MetricSpec:
    key: str
    label: str
    unit: str
    source: Source
    alpha: float
    flat_threshold: float


def _body(key: str, label: str, unit: str, flat: float = 0.05) -> MetricSpec:
    return MetricSpec(key, label, unit, "body", 0.1, flat)


def _tape(key: str, label: str) -> MetricSpec:
    return MetricSpec(key, label, "cm", "measurement", 0.3, 0.1)


METRICS: dict[str, MetricSpec] = {
    m.key: m
    for m in (
        _body("weight_kg", "Weight", "kg"),
        _body("body_fat_pct", "Body fat", "%"),
        _body("muscle_mass_kg", "Muscle mass", "kg"),
        _body("skeletal_muscle_pct", "Skeletal muscle", "%"),
        _body("body_water_pct", "Body water", "%"),
        _body("bone_mass_kg", "Bone mass", "kg", 0.01),
        _body("visceral_fat", "Visceral fat", "", 0.1),
        _body("protein_pct", "Protein", "%"),
        _body("bmr_kcal", "BMR", "kcal", 5),
        _body("metabolic_age", "Metabolic age", "yrs", 0.1),
        _body("bmi", "BMI", "", 0.02),
        _body("fat_mass_kg", "Fat mass", "kg"),
        _body("lean_mass_kg", "Lean mass", "kg"),
        _tape("waist_cm", "Waist"),
        _tape("hips_cm", "Hips"),
        _tape("chest_cm", "Chest"),
        _tape("neck_cm", "Neck"),
        _tape("arm_cm", "Arm"),
        _tape("thigh_cm", "Thigh"),
        MetricSpec("navy_body_fat_pct", "Body fat (Navy)", "%", "measurement", 0.3, 0.05),
    )
}

_DIRECT_BODY = {"weight_kg", *OPTIONAL_SCALE_FIELDS}
_DIRECT_TAPE = set(MEASUREMENT_FIELDS)


def _column(
    conn: Conn, table: Literal["body_entries", "measurements"], col: str, user_id: UUID
) -> Readings:
    query = sql.SQL(
        "select measured_at, {c} as value from {t}"
        " where user_id = %s and {c} is not null order by measured_at"
    ).format(c=sql.Identifier(col), t=sql.Identifier(table))
    return [(r["measured_at"], float(r["value"])) for r in conn.execute(query, (user_id,))]


def load_readings(conn: Conn, user_id: UUID, metric: str, profile: Profile | None) -> Readings:
    if metric in _DIRECT_BODY:
        return _column(conn, "body_entries", metric, user_id)
    if metric in _DIRECT_TAPE:
        return _column(conn, "measurements", metric, user_id)
    if metric == "bmi":
        if profile is None:
            return []
        weights = _column(conn, "body_entries", "weight_kg", user_id)
        return [(t, bmi(w, profile.height_cm)) for t, w in weights]
    if metric in ("fat_mass_kg", "lean_mass_kg"):
        rows = conn.execute(
            "select measured_at, weight_kg, body_fat_pct from body_entries"
            " where user_id = %s and body_fat_pct is not null order by measured_at",
            (user_id,),
        ).fetchall()
        fn = fat_mass_kg if metric == "fat_mass_kg" else lean_mass_kg
        return [
            (r["measured_at"], fn(float(r["weight_kg"]), float(r["body_fat_pct"]))) for r in rows
        ]
    if metric == "navy_body_fat_pct":
        rows = conn.execute(
            "select measured_at, waist_cm, neck_cm, hips_cm from measurements"
            " where user_id = %s and waist_cm is not null and neck_cm is not null"
            " order by measured_at",
            (user_id,),
        ).fetchall()
        readings: Readings = []
        for r in rows:
            value = navy_for(r, profile)
            if value is not None:
                readings.append((r["measured_at"], value))
        return readings
    raise KeyError(metric)

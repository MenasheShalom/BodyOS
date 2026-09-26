from dataclasses import dataclass
from datetime import date
from uuid import UUID
from zoneinfo import ZoneInfo

from app.calculations.body import Sex
from app.db import Conn


@dataclass(frozen=True)
class Profile:
    height_cm: float
    sex: Sex
    date_of_birth: date
    timezone: str
    hidden_metrics: list[str]

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


def load_profile(conn: Conn, user_id: UUID) -> Profile | None:
    row = conn.execute(
        "select height_cm, sex, date_of_birth, timezone, hidden_metrics"
        " from profiles where user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    return Profile(
        height_cm=float(row["height_cm"]),
        sex=row["sex"],
        date_of_birth=row["date_of_birth"],
        timezone=row["timezone"],
        hidden_metrics=list(row["hidden_metrics"]),
    )

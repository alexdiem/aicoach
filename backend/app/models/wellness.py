from datetime import date, datetime
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DailyWellness(Base):
    __tablename__ = "daily_wellness"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    athlete_id: Mapped[int] = mapped_column(Integer, ForeignKey("athletes.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)

    body_battery_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    body_battery_min: Mapped[float | None] = mapped_column(Float, nullable=True)

    # "Balanced" | "Unbalanced" | "Low" | None
    hrv_status: Mapped[str | None] = mapped_column(String, nullable=True)
    hrv_last_night_avg: Mapped[float | None] = mapped_column(Float, nullable=True)

    sleep_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    resting_heart_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_stress_level: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("athlete_id", "date", name="uq_wellness_athlete_date"),)

from datetime import datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, Integer, Boolean, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    athlete_id: Mapped[int] = mapped_column(Integer, ForeignKey("athletes.id"), index=True)
    garmin_activity_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)

    # Activity classification
    activity_type: Mapped[str] = mapped_column(String)  # CYCLING, RUNNING, XC_SKIING, HIKING, CLIMBING, STRENGTH, OTHER
    sport_category: Mapped[str] = mapped_column(String)  # AEROBIC_TRAINING, CASUAL, STRENGTH

    # Timing
    start_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    duration_seconds: Mapped[float] = mapped_column(Float)

    # Metrics
    distance_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    elevation_gain_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_heart_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_heart_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_power_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    normalized_power_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_pace_seconds_per_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    training_stress_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    intensity_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    hrv_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    is_indoor: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    garmin_raw: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    athlete: Mapped["Athlete"] = relationship("Athlete", back_populates="activities")

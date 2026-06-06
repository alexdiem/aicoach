from datetime import datetime, date
from sqlalchemy import String, Float, DateTime, Date, ForeignKey, Integer, Boolean, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WeeklyPlan(Base):
    __tablename__ = "weekly_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    athlete_id: Mapped[int] = mapped_column(Integer, ForeignKey("athletes.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    season: Mapped[str] = mapped_column(String)  # CYCLING_RUNNING, SKI
    phase: Mapped[str] = mapped_column(String)  # BASE, BUILD, PEAK, RECOVERY
    ctl_at_generation: Mapped[float] = mapped_column(Float)
    ai_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    athlete: Mapped["Athlete"] = relationship("Athlete", back_populates="plans")
    workouts: Mapped[list["PlannedWorkout"]] = relationship("PlannedWorkout", back_populates="plan", order_by="PlannedWorkout.day_of_week")


class PlannedWorkout(Base):
    __tablename__ = "planned_workouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("weekly_plans.id"), index=True)
    day_of_week: Mapped[int] = mapped_column(Integer)  # 0=Monday ... 6=Sunday
    sport: Mapped[str] = mapped_column(String)  # CYCLING, RUNNING, XC_SKIING, STRENGTH
    workout_type: Mapped[str] = mapped_column(String)  # EASY, TEMPO, THRESHOLD, VO2MAX, LONG, RECOVERY, STRENGTH
    duration_minutes: Mapped[int] = mapped_column(Integer)
    intensity_zone: Mapped[str | None] = mapped_column(String, nullable=True)  # Z1, Z2, Z3, Z4, Z5
    purpose: Mapped[str] = mapped_column(Text)

    suggested_route_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("routes.id"), nullable=True)
    terrain_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    structured_session: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_unstructured: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_activity_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("activities.id"), nullable=True)
    compliance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_compliance_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    plan: Mapped["WeeklyPlan"] = relationship("WeeklyPlan", back_populates="workouts")
    suggested_route: Mapped["Route | None"] = relationship("Route", foreign_keys=[suggested_route_id])
    completed_activity: Mapped["Activity | None"] = relationship("Activity", foreign_keys=[completed_activity_id])

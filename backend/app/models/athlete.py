from datetime import datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Athlete(Base):
    __tablename__ = "athletes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    garmin_user_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    ftp_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    lthr: Mapped[float | None] = mapped_column(Float, nullable=True)
    vo2max_running: Mapped[float | None] = mapped_column(Float, nullable=True)
    vo2max_cycling: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    token: Mapped["GarminToken | None"] = relationship("GarminToken", back_populates="athlete", uselist=False)
    activities: Mapped[list["Activity"]] = relationship("Activity", back_populates="athlete")
    plans: Mapped[list["WeeklyPlan"]] = relationship("WeeklyPlan", back_populates="athlete")
    routes: Mapped[list["Route"]] = relationship("Route", back_populates="athlete")


class GarminToken(Base):
    __tablename__ = "garmin_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    athlete_id: Mapped[int] = mapped_column(Integer, ForeignKey("athletes.id"), unique=True)
    access_token: Mapped[str] = mapped_column(String)
    access_token_secret: Mapped[str] = mapped_column(String)  # OAuth 1.0a
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    athlete: Mapped["Athlete"] = relationship("Athlete", back_populates="token")

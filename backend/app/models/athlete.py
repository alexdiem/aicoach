from datetime import datetime
from sqlalchemy import String, Float, DateTime, Integer
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

    activities: Mapped[list["Activity"]] = relationship("Activity", back_populates="athlete")
    plans: Mapped[list["WeeklyPlan"]] = relationship("WeeklyPlan", back_populates="athlete")
    routes: Mapped[list["Route"]] = relationship("Route", back_populates="athlete")

from datetime import datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, Integer, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    athlete_id: Mapped[int] = mapped_column(Integer, ForeignKey("athletes.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    gpx_data: Mapped[str] = mapped_column(Text)  # raw GPX XML
    total_distance_meters: Mapped[float] = mapped_column(Float)
    total_elevation_gain_meters: Mapped[float] = mapped_column(Float)
    analysis: Mapped[dict] = mapped_column(JSON)  # {segments, terrain_type, ...}
    strava_segment_id: Mapped[str | None] = mapped_column(String, nullable=True)
    start_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    performance_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source_file_type: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    athlete: Mapped["Athlete"] = relationship("Athlete", back_populates="routes")

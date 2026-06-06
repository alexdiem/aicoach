from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_athlete_or_404
from app.models.activity import Activity
from app.models.athlete import Athlete
from app.services.fitness import (
    calculate_ctl_atl_tsb,
    calculate_daily_loads,
    cross_sport_aerobic_transfer,
    estimate_vo2max_trend,
)
from app.services.season_detector import detect_season

router = APIRouter(prefix="/athlete", tags=["athlete"])


class AthleteUpdate(BaseModel):
    display_name: str | None = None
    ftp_watts: float | None = None
    lthr: float | None = None


@router.get("/{athlete_id}")
async def get_athlete(athlete: Athlete = Depends(get_athlete_or_404)):
    return {
        "id": athlete.id,
        "display_name": athlete.display_name,
        "ftp_watts": athlete.ftp_watts,
        "lthr": athlete.lthr,
        "vo2max_running": athlete.vo2max_running,
        "vo2max_cycling": athlete.vo2max_cycling,
    }


@router.patch("/{athlete_id}")
async def update_athlete(update: AthleteUpdate, athlete: Athlete = Depends(get_athlete_or_404)):
    if update.display_name is not None:
        athlete.display_name = update.display_name
    if update.ftp_watts is not None:
        athlete.ftp_watts = update.ftp_watts
    if update.lthr is not None:
        athlete.lthr = update.lthr
    return {"updated": True}


@router.get("/{athlete_id}/fitness")
async def get_fitness_metrics(
    days: int = 90,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    """Return CTL/ATL/TSB time series and cross-sport transfer breakdown."""
    cutoff = date.today() - timedelta(days=max(days, 90))
    acts_result = await db.execute(
        select(Activity)
        .where(Activity.athlete_id == athlete.id, Activity.start_time >= cutoff)
        .order_by(Activity.start_time)
    )
    activities = list(acts_result.scalars().all())

    daily_loads = calculate_daily_loads(activities, athlete)
    series = calculate_ctl_atl_tsb(daily_loads, days=days)
    transfer = cross_sport_aerobic_transfer(activities, athlete)

    season, confidence = detect_season(activities)
    vo2max_cycling = estimate_vo2max_trend(activities, "CYCLING")
    vo2max_running = estimate_vo2max_trend(activities, "RUNNING")
    vo2max_skiing = estimate_vo2max_trend(activities, "XC_SKIING")

    latest = series[-1] if series else {"ctl": 0, "atl": 0, "tsb": 0}

    return {
        "series": series,
        "current": latest,
        "cross_sport_transfer": transfer,
        "season": season,
        "season_confidence": round(confidence, 2),
        "vo2max_trends": {
            "cycling": vo2max_cycling,
            "running": vo2max_running,
            "skiing": vo2max_skiing,
        },
    }

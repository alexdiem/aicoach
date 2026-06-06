from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_athlete_or_404
from app.models.activity import Activity
from app.models.athlete import Athlete
from app.models.wellness import DailyWellness
from app.services.fitness import (
    calculate_ctl_atl_tsb,
    calculate_daily_loads,
    calculate_readiness,
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

    wellness_result = await db.execute(
        select(DailyWellness)
        .where(
            DailyWellness.athlete_id == athlete.id,
            DailyWellness.date >= date.today() - timedelta(days=7),
        )
        .order_by(desc(DailyWellness.date))
    )
    wellness_rows = list(wellness_result.scalars().all())
    readiness = calculate_readiness(latest["tsb"], wellness_rows)

    recent_wellness = [
        {
            "date": w.date.isoformat(),
            "body_battery_max": w.body_battery_max,
            "hrv_status": w.hrv_status,
            "hrv_last_night_avg": w.hrv_last_night_avg,
            "sleep_score": w.sleep_score,
            "sleep_hours": round(w.sleep_duration_seconds / 3600, 1) if w.sleep_duration_seconds else None,
            "resting_hr": w.resting_heart_rate,
            "avg_stress": w.avg_stress_level,
        }
        for w in wellness_rows
    ]

    return {
        "series": series,
        "current": latest,
        "readiness": readiness,
        "recent_wellness": recent_wellness,
        "cross_sport_transfer": transfer,
        "season": season,
        "season_confidence": round(confidence, 2),
        "vo2max_trends": {
            "cycling": vo2max_cycling,
            "running": vo2max_running,
            "skiing": vo2max_skiing,
        },
    }

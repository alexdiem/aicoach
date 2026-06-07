import asyncio
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.wellness import DailyWellness
from app.services.garmin import get_garmin_client, parse_garmin_activity, parse_wellness

router = APIRouter(prefix="/activities", tags=["activities"])

_WELLNESS_WINDOW = 14  # days of wellness to sync regardless of days_back


@router.post("/sync")
async def sync_activities(
    athlete_id: int,
    days_back: int = Query(default=30, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Pull recent activities and wellness data from Garmin Connect."""
    garmin = get_garmin_client()
    end = date.today()
    start = end - timedelta(days=days_back)

    try:
        raw_activities = await garmin.get_activities(start, end)
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("Garmin sync failed")
        raise HTTPException(status_code=502, detail=f"Garmin fetch failed: {type(e).__name__}: {e}")

    new_count = 0
    for raw in raw_activities:
        parsed = parse_garmin_activity(raw)
        garmin_id = parsed.get("garmin_activity_id")
        if garmin_id:
            existing = await db.execute(select(Activity).where(Activity.garmin_activity_id == garmin_id))
            if existing.scalar_one_or_none():
                continue

        activity = Activity(athlete_id=athlete_id, **{k: v for k, v in parsed.items()})
        db.add(activity)
        new_count += 1

    # Sync wellness for the recent window (concurrent fetches per day)
    wellness_start = end - timedelta(days=_WELLNESS_WINDOW - 1)
    wellness_dates = [wellness_start + timedelta(days=i) for i in range(_WELLNESS_WINDOW)]

    async def _fetch_day(d: date):
        results = await asyncio.gather(
            garmin.get_stats(d),
            garmin.get_hrv_data(d),
            garmin.get_sleep_data(d),
            garmin.get_body_battery(d),
            return_exceptions=True,
        )
        return d, tuple(r if not isinstance(r, Exception) else None for r in results)

    day_results = await asyncio.gather(*[_fetch_day(d) for d in wellness_dates])

    for d, (stats, hrv, sleep, bb) in day_results:
        parsed_w = parse_wellness(stats, hrv, sleep, bb)
        if not any(v is not None for v in parsed_w.values()):
            continue
        existing = await db.execute(
            select(DailyWellness).where(
                DailyWellness.athlete_id == athlete_id,
                DailyWellness.date == d,
            )
        )
        row = existing.scalar_one_or_none()
        if row is None:
            row = DailyWellness(athlete_id=athlete_id, date=d)
            db.add(row)
        for k, v in parsed_w.items():
            if v is not None:
                setattr(row, k, v)

    return {"synced": new_count, "date_range": f"{start} to {end}"}


@router.get("")
async def list_activities(
    athlete_id: int,
    activity_type: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
):
    q = select(Activity).where(Activity.athlete_id == athlete_id).order_by(desc(Activity.start_time)).limit(limit)
    if activity_type:
        q = q.where(Activity.activity_type == activity_type.upper())
    result = await db.execute(q)
    activities = result.scalars().all()
    return [_serialize_activity(a) for a in activities]


@router.get("/{activity_id}")
async def get_activity(activity_id: int, athlete_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id, Activity.athlete_id == athlete_id)
    )
    act = result.scalar_one_or_none()
    if not act:
        raise HTTPException(status_code=404, detail="Activity not found.")
    return _serialize_activity(act)


def _serialize_activity(a: Activity) -> dict:
    return {
        "id": a.id,
        "garmin_activity_id": a.garmin_activity_id,
        "activity_type": a.activity_type,
        "sport_category": a.sport_category,
        "start_time": a.start_time.isoformat(),
        "duration_seconds": a.duration_seconds,
        "distance_meters": a.distance_meters,
        "elevation_gain_meters": a.elevation_gain_meters,
        "avg_heart_rate": a.avg_heart_rate,
        "avg_power_watts": a.avg_power_watts,
        "normalized_power_watts": a.normalized_power_watts,
        "training_stress_score": a.training_stress_score,
        "hrv_score": a.hrv_score,
        "is_indoor": a.is_indoor,
        "notes": a.notes,
    }

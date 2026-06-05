"""
Authentication via python-garminconnect (username + password stored in .env).
No OAuth flow needed — the library handles Garmin's SSO internally.
The "connect" endpoint just validates credentials and creates/returns the athlete record.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.athlete import Athlete
from app.services.garmin import get_garmin_client

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/connect")
async def connect(db: AsyncSession = Depends(get_db)):
    """
    Validate Garmin credentials from .env and create/return the athlete record.
    Call this once after setting GARMIN_EMAIL and GARMIN_PASSWORD in .env.
    """
    if not settings.GARMIN_EMAIL or not settings.GARMIN_PASSWORD:
        raise HTTPException(
            status_code=400,
            detail="GARMIN_EMAIL and GARMIN_PASSWORD must be set in your .env file.",
        )

    garmin = get_garmin_client()

    try:
        profile = await garmin.get_user_profile()
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Garmin login failed: {e}. Check your credentials in .env.")

    garmin_user_id = str(
        profile.get("userId")
        or profile.get("userProfileId")
        or profile.get("displayName", "unknown")
    )
    display_name = (
        profile.get("displayName")
        or profile.get("fullName")
        or profile.get("userName")
        or "Athlete"
    )

    # Fetch VO2max if available
    vo2max_cycling = None
    vo2max_running = None
    try:
        metrics = await garmin.get_max_metrics()
        if metrics:
            vo2max_cycling = metrics.get("vo2MaxPreciseValue") or metrics.get("vo2MaxValue")
            vo2max_running = metrics.get("vo2MaxPreciseValue") or metrics.get("vo2MaxValue")
    except Exception:
        pass

    # Upsert athlete
    result = await db.execute(select(Athlete).where(Athlete.garmin_user_id == garmin_user_id))
    athlete = result.scalar_one_or_none()
    if not athlete:
        athlete = Athlete(
            garmin_user_id=garmin_user_id,
            display_name=display_name,
            vo2max_running=vo2max_running,
            vo2max_cycling=vo2max_cycling,
        )
        db.add(athlete)
    else:
        if display_name:
            athlete.display_name = display_name

    await db.flush()

    return {
        "connected": True,
        "athlete_id": athlete.id,
        "display_name": athlete.display_name,
        "garmin_user_id": garmin_user_id,
    }


@router.get("/status")
async def auth_status(athlete_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Athlete).where(Athlete.id == athlete_id))
    athlete = result.scalar_one_or_none()
    if not athlete:
        return {"connected": False}
    credentials_set = bool(settings.GARMIN_EMAIL and settings.GARMIN_PASSWORD)
    return {
        "connected": credentials_set,
        "athlete_id": athlete.id,
        "display_name": athlete.display_name,
        "ftp_watts": athlete.ftp_watts,
        "lthr": athlete.lthr,
    }

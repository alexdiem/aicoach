"""
Garmin Health API push notification handler.
Garmin POSTs activity summaries and wellness data to this endpoint.
Register this URL in your Garmin developer console.
"""
import logging
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import verify_api_key
from app.models.activity import Activity
from app.models.athlete import Athlete
from app.services.garmin import parse_garmin_activity

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/garmin", tags=["garmin-webhook"], dependencies=[Depends(verify_api_key)])


@router.post("/webhook")
async def receive_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Garmin pushes activity summaries here automatically after each workout.
    Payload format: {"activityDetails": [...]} or wellness data.
    """
    try:
        body = await request.json()
    except Exception:
        return {"status": "ok"}  # Garmin expects 200 OK always

    # Handle activity summaries
    activities = body.get("activityDetails", body.get("activities", []))
    for raw in activities:
        await _process_push_activity(raw, db)

    return {"status": "ok"}


async def _process_push_activity(raw: dict, db: AsyncSession):
    try:
        parsed = parse_garmin_activity(raw)
        garmin_id = parsed.get("garmin_activity_id")
        user_id = str(raw.get("userId", ""))

        # Find athlete by Garmin user ID
        if not user_id:
            return

        athlete_result = await db.execute(select(Athlete).where(Athlete.garmin_user_id == user_id))
        athlete = athlete_result.scalar_one_or_none()
        if not athlete:
            logger.warning(f"Received webhook for unknown Garmin user: {user_id}")
            return

        # Skip if already stored
        if garmin_id:
            existing = await db.execute(select(Activity).where(Activity.garmin_activity_id == garmin_id))
            if existing.scalar_one_or_none():
                return

        activity = Activity(athlete_id=athlete.id, **{k: v for k, v in parsed.items()})
        db.add(activity)
        logger.info(f"Stored pushed activity {garmin_id} for athlete {athlete.id}")

    except Exception as e:
        logger.error(f"Error processing webhook activity: {e}")

"""
Garmin OAuth 1.0a three-legged flow.
/auth/login → Garmin authorize page → /auth/callback → store tokens → redirect to frontend
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.athlete import Athlete, GarminToken
from app.services.garmin import (
    exchange_for_access_token,
    get_authorization_url,
    get_request_token,
    GarminClient,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory temp storage for request token secrets (production: use Redis/DB)
_pending_tokens: dict[str, str] = {}


@router.get("/login")
async def login():
    """Redirect user to Garmin OAuth authorization page."""
    try:
        token_data = await get_request_token()
        oauth_token = token_data["oauth_token"]
        oauth_token_secret = token_data["oauth_token_secret"]
        _pending_tokens[oauth_token] = oauth_token_secret
        auth_url = get_authorization_url(oauth_token)
        return RedirectResponse(url=auth_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initiate Garmin OAuth: {e}")


@router.get("/callback")
async def callback(
    oauth_token: str,
    oauth_verifier: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle Garmin OAuth callback, store tokens, redirect to frontend."""
    oauth_token_secret = _pending_tokens.pop(oauth_token, None)
    if not oauth_token_secret:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth token.")

    try:
        access_data = await exchange_for_access_token(oauth_token, oauth_token_secret, oauth_verifier)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token exchange failed: {e}")

    access_token = access_data["oauth_token"]
    access_token_secret = access_data["oauth_token_secret"]

    # Fetch user ID from Garmin
    try:
        garmin = GarminClient(access_token, access_token_secret)
        metrics = await garmin.get_user_metrics()
        garmin_user_id = str(metrics.get("userId") or metrics.get("userProfilePK") or access_token[:16])
        display_name = metrics.get("displayName") or "Athlete"
        vo2max_running = metrics.get("vo2MaxRunning")
        vo2max_cycling = metrics.get("vo2MaxCycling")
    except Exception:
        garmin_user_id = access_token[:16]
        display_name = "Athlete"
        vo2max_running = None
        vo2max_cycling = None

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
        await db.flush()

    # Upsert token
    result = await db.execute(select(GarminToken).where(GarminToken.athlete_id == athlete.id))
    token_record = result.scalar_one_or_none()
    if token_record:
        token_record.access_token = access_token
        token_record.access_token_secret = access_token_secret
    else:
        token_record = GarminToken(
            athlete_id=athlete.id,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        db.add(token_record)

    return RedirectResponse(url=f"{settings.FRONTEND_URL}?connected=true&athlete_id={athlete.id}")


@router.get("/status")
async def auth_status(athlete_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Athlete).where(Athlete.id == athlete_id)
    )
    athlete = result.scalar_one_or_none()
    if not athlete:
        return {"connected": False}
    return {
        "connected": True,
        "athlete_id": athlete.id,
        "display_name": athlete.display_name,
        "ftp_watts": athlete.ftp_watts,
        "lthr": athlete.lthr,
    }

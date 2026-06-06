"""
Garmin Connect data fetching via python-garminconnect (unofficial library).
Uses the same SSO auth flow as the Garmin Connect mobile app.
No developer account or API approval needed — just your Garmin Connect credentials.

Library: https://github.com/cyberjunky/python-garminconnect
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from functools import lru_cache

from garminconnect import Garmin, GarminConnectAuthenticationError

from app.config import settings

logger = logging.getLogger(__name__)

# Token cache path — the library persists OAuth tokens here to avoid re-login
TOKENSTORE = "/tmp/garmin_tokens"


def _make_client() -> Garmin:
    """Create and authenticate a Garmin client, reusing cached tokens when possible."""
    client = Garmin(
        email=settings.GARMIN_EMAIL,
        password=settings.GARMIN_PASSWORD,
        is_cn=False,
        return_on_mfa=False,
    )
    try:
        client.login(TOKENSTORE)
    except (FileNotFoundError, GarminConnectAuthenticationError):
        client.login()
        client.garth.dump(TOKENSTORE)
    return client


def _run_sync(fn, *args, **kwargs):
    """Run a blocking garminconnect call in a thread pool to keep FastAPI async."""
    return asyncio.get_event_loop().run_in_executor(None, lambda: fn(*args, **kwargs))


class GarminClient:
    """Async wrapper around the synchronous python-garminconnect library."""

    def __init__(self):
        self._client: Garmin | None = None

    def _get(self) -> Garmin:
        if self._client is None:
            self._client = _make_client()
        return self._client

    async def get_activities(self, start_date: date, end_date: date) -> list[dict]:
        """Fetch all activities in a date range."""
        client = self._get()
        days = (end_date - start_date).days + 1

        def _fetch():
            # The library fetches by start offset + limit; we use a large limit
            return client.get_activities_by_date(
                start_date.isoformat(), end_date.isoformat()
            )

        result = await _run_sync(_fetch)
        return result or []

    async def get_activity_details(self, activity_id: int) -> dict:
        client = self._get()
        return await _run_sync(client.get_activity_details, activity_id)

    async def get_hrv_data(self, target_date: date) -> dict | None:
        client = self._get()
        try:
            return await _run_sync(client.get_hrv_data, target_date.isoformat())
        except Exception:
            return None

    async def get_sleep_data(self, target_date: date) -> dict | None:
        client = self._get()
        try:
            return await _run_sync(client.get_sleep_data, target_date.isoformat())
        except Exception:
            return None

    async def get_user_profile(self) -> dict:
        client = self._get()
        return await _run_sync(client.get_user_profile)

    async def get_stats(self, target_date: date) -> dict | None:
        """Daily wellness stats — steps, calories, stress, etc."""
        client = self._get()
        try:
            return await _run_sync(client.get_stats, target_date.isoformat())
        except Exception:
            return None

    async def get_max_metrics(self) -> dict | None:
        """VO2max and fitness age from Garmin."""
        client = self._get()
        try:
            return await _run_sync(client.get_max_metrics, date.today().isoformat())
        except Exception:
            return None


# Module-level singleton — one client per server process
_garmin_client: GarminClient | None = None


def get_garmin_client() -> GarminClient:
    global _garmin_client
    if _garmin_client is None:
        _garmin_client = GarminClient()
    return _garmin_client


# ─── Activity normalization ────────────────────────────────────────────────────

ACTIVITY_TYPE_MAP = {
    "cycling": "CYCLING",
    "indoor_cycling": "CYCLING",
    "mountain_biking": "CYCLING",
    "road_biking": "CYCLING",
    "gravel_cycling": "CYCLING",
    "running": "RUNNING",
    "trail_running": "RUNNING",
    "treadmill_running": "RUNNING",
    "cross_country_skiing": "XC_SKIING",
    "skate_skiing": "XC_SKIING",
    "xc_classic_skiing": "XC_SKIING",
    "backcountry_skiing": "XC_SKIING",
    "hiking": "HIKING",
    "rock_climbing": "CLIMBING",
    "strength_training": "STRENGTH",
    "fitness_equipment": "STRENGTH",
    "yoga": "OTHER",
    "swimming": "OTHER",
    "open_water_swimming": "OTHER",
}

_CASUAL = {"HIKING", "CLIMBING"}
_STRENGTH = {"STRENGTH"}
_AEROBIC = {"CYCLING", "RUNNING", "XC_SKIING"}


def parse_garmin_activity(raw: dict) -> dict:
    """Normalize a raw python-garminconnect activity dict to our internal format."""
    type_key = (
        raw.get("activityType", {}).get("typeKey", "")
        or raw.get("activityType", "")
    ).lower().replace(" ", "_")

    internal_type = ACTIVITY_TYPE_MAP.get(type_key, "OTHER")

    if internal_type in _AEROBIC:
        sport_category = "AEROBIC_TRAINING"
    elif internal_type in _CASUAL:
        sport_category = "CASUAL"
    elif internal_type in _STRENGTH:
        sport_category = "STRENGTH"
    else:
        sport_category = "AEROBIC_TRAINING"

    # Start time — the library returns ISO strings
    start_raw = raw.get("startTimeLocal") or raw.get("startTimeGMT", "")
    try:
        start_time = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
    except Exception:
        start_time = datetime.utcnow()

    # Distance: library returns meters
    distance = raw.get("distance") or raw.get("distanceInMeters")

    # Power: cycling
    avg_power = raw.get("averagePower") or raw.get("avgPower")
    norm_power = raw.get("normPower") or raw.get("normalizedPower")

    # Pace: running/skiing (library gives m/s as averageSpeed)
    speed = raw.get("averageSpeed")
    pace_s_per_km = (1000 / speed) if speed and speed > 0 else None

    is_indoor = type_key in ("indoor_cycling", "treadmill_running", "fitness_equipment")

    return {
        "garmin_activity_id": str(raw.get("activityId", "")),
        "activity_type": internal_type,
        "sport_category": sport_category,
        "start_time": start_time,
        "duration_seconds": raw.get("duration") or raw.get("elapsedDuration") or 0,
        "distance_meters": float(distance) if distance else None,
        "elevation_gain_meters": raw.get("elevationGain"),
        "avg_heart_rate": raw.get("averageHR") or raw.get("avgHr"),
        "max_heart_rate": raw.get("maxHR") or raw.get("maxHr"),
        "avg_power_watts": float(avg_power) if avg_power else None,
        "normalized_power_watts": float(norm_power) if norm_power else None,
        "avg_pace_seconds_per_km": pace_s_per_km,
        "training_stress_score": raw.get("trainingStressScore"),
        "intensity_factor": raw.get("intensityFactor"),
        "is_indoor": is_indoor,
        "garmin_raw": raw,
    }

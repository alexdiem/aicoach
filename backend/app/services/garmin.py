"""
Garmin Health API client using OAuth 1.0a (consumer key + user token).

The Garmin Health API uses OAuth 1.0a — not OAuth 2.0. The developer registers
an app and gets a consumer key/secret. Users authorize via a three-legged OAuth
1.0a flow. This client handles the full flow.

Garmin Health API docs: https://developer.garmin.com/health-api/overview/
"""
from __future__ import annotations

import hashlib
import hmac
import random
import string
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from authlib.integrations.httpx_client import AsyncOAuth1Client

from app.config import settings

GARMIN_REQUEST_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/request_token"
GARMIN_AUTHORIZE_URL = "https://connect.garmin.com/oauthConfirm"
GARMIN_ACCESS_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/access_token"
GARMIN_API_BASE = "https://healthapi.garmin.com/wellness-api/rest"


def _make_oauth1_client(
    access_token: str | None = None,
    access_token_secret: str | None = None,
) -> AsyncOAuth1Client:
    return AsyncOAuth1Client(
        client_id=settings.GARMIN_CLIENT_ID,
        client_secret=settings.GARMIN_CLIENT_SECRET,
        token=access_token,
        token_secret=access_token_secret,
    )


async def get_request_token() -> dict:
    """Step 1: Get a temporary request token."""
    async with _make_oauth1_client() as client:
        resp = await client.fetch_request_token(
            GARMIN_REQUEST_TOKEN_URL,
            params={"oauth_callback": settings.GARMIN_REDIRECT_URI},
        )
        return resp


def get_authorization_url(oauth_token: str) -> str:
    """Step 2: Build the URL to redirect the user to for authorization."""
    return f"{GARMIN_AUTHORIZE_URL}?oauth_token={urllib.parse.quote(oauth_token)}"


async def exchange_for_access_token(
    oauth_token: str,
    oauth_token_secret: str,
    oauth_verifier: str,
) -> dict:
    """Step 3: Exchange verifier for access token."""
    async with _make_oauth1_client(oauth_token, oauth_token_secret) as client:
        resp = await client.fetch_access_token(
            GARMIN_ACCESS_TOKEN_URL,
            verifier=oauth_verifier,
        )
        return resp  # {"oauth_token": ..., "oauth_token_secret": ...}


class GarminClient:
    """Authenticated Garmin Health API client for a specific user."""

    def __init__(self, access_token: str, access_token_secret: str):
        self.access_token = access_token
        self.access_token_secret = access_token_secret

    def _client(self) -> AsyncOAuth1Client:
        return _make_oauth1_client(self.access_token, self.access_token_secret)

    async def get_activities(
        self,
        start_date: date,
        end_date: date,
    ) -> list[dict]:
        """Fetch activity summaries for a date range."""
        start_ts = int(datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc).timestamp())
        end_ts = int(datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc).timestamp())

        url = f"{GARMIN_API_BASE}/activities"
        params = {"uploadStartTimeInSeconds": start_ts, "uploadEndTimeInSeconds": end_ts}

        async with self._client() as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_daily_summaries(
        self,
        start_date: date,
        end_date: date,
    ) -> list[dict]:
        """Fetch daily wellness summaries (steps, sleep, stress, HRV)."""
        url = f"{GARMIN_API_BASE}/dailies"
        params = {
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
        }
        async with self._client() as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_sleep_data(self, start_date: date, end_date: date) -> list[dict]:
        url = f"{GARMIN_API_BASE}/sleep"
        params = {"startDate": start_date.isoformat(), "endDate": end_date.isoformat()}
        async with self._client() as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_hrv_data(self, start_date: date, end_date: date) -> list[dict]:
        url = f"{GARMIN_API_BASE}/hrv"
        params = {"startDate": start_date.isoformat(), "endDate": end_date.isoformat()}
        async with self._client() as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_user_metrics(self) -> dict:
        """Fetch user metrics including VO2max."""
        url = f"{GARMIN_API_BASE}/userMetrics"
        async with self._client() as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()


def parse_garmin_activity(raw: dict) -> dict:
    """
    Normalize a raw Garmin activity summary into our internal format.
    Maps Garmin activity types to our internal types.
    """
    garmin_type_map = {
        "CYCLING": "CYCLING",
        "INDOOR_CYCLING": "CYCLING",
        "MOUNTAIN_BIKING": "CYCLING",
        "ROAD_BIKING": "CYCLING",
        "RUNNING": "RUNNING",
        "TRAIL_RUNNING": "RUNNING",
        "TREADMILL_RUNNING": "RUNNING",
        "CROSS_COUNTRY_SKIING": "XC_SKIING",
        "XC_CLASSIC_SKIING": "XC_SKIING",
        "SKATE_SKIING": "XC_SKIING",
        "HIKING": "HIKING",
        "ROCK_CLIMBING": "CLIMBING",
        "STRENGTH_TRAINING": "STRENGTH",
        "FITNESS_EQUIPMENT": "STRENGTH",
    }
    casual_types = {"HIKING", "CLIMBING"}
    strength_types = {"STRENGTH"}
    aerobic_types = {"CYCLING", "RUNNING", "XC_SKIING"}

    activity_type_raw = raw.get("activityType", {})
    if isinstance(activity_type_raw, dict):
        garmin_type = activity_type_raw.get("typeKey", "OTHER").upper()
    else:
        garmin_type = str(activity_type_raw).upper()

    internal_type = garmin_type_map.get(garmin_type, "OTHER")

    if internal_type in aerobic_types:
        sport_category = "AEROBIC_TRAINING"
    elif internal_type in casual_types:
        sport_category = "CASUAL"
    elif internal_type in strength_types:
        sport_category = "STRENGTH"
    else:
        sport_category = "AEROBIC_TRAINING"

    start_time_raw = raw.get("startTimeLocal") or raw.get("startTimeGMT", "")
    try:
        start_time = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
    except Exception:
        start_time = datetime.utcnow()

    return {
        "garmin_activity_id": str(raw.get("activityId", "")),
        "activity_type": internal_type,
        "sport_category": sport_category,
        "start_time": start_time,
        "duration_seconds": raw.get("duration", 0),
        "distance_meters": raw.get("distance"),
        "elevation_gain_meters": raw.get("elevationGain"),
        "avg_heart_rate": raw.get("averageHR"),
        "max_heart_rate": raw.get("maxHR"),
        "avg_power_watts": raw.get("avgPower"),
        "normalized_power_watts": raw.get("normPower"),
        "avg_pace_seconds_per_km": _pace(raw.get("averageSpeed")),
        "training_stress_score": raw.get("trainingStressScore"),
        "intensity_factor": raw.get("intensityFactor"),
        "is_indoor": garmin_type in ("INDOOR_CYCLING", "TREADMILL_RUNNING"),
        "garmin_raw": raw,
    }


def _pace(speed_ms: float | None) -> float | None:
    """Convert m/s to seconds/km."""
    if not speed_ms or speed_ms <= 0:
        return None
    return 1000 / speed_ms

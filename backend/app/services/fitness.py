"""
Training load calculations: ATL, CTL, TSB, TSS estimation, and cross-sport aerobic transfer.
All math is deterministic — no AI calls here.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.models.activity import Activity
    from app.models.athlete import Athlete

# Aerobic transfer coefficients: how much CTL from sport A counts toward sport B
TRANSFER_MATRIX = {
    ("XC_SKIING", "RUNNING"): 0.85,
    ("RUNNING", "XC_SKIING"): 0.85,
    ("XC_SKIING", "CYCLING"): 0.65,
    ("CYCLING", "XC_SKIING"): 0.65,
    ("RUNNING", "CYCLING"): 0.60,
    ("CYCLING", "RUNNING"): 0.60,
}

# CTL time constant (days), ATL time constant (days)
CTL_TC = 42
ATL_TC = 7


def calculate_tss(activity: "Activity", athlete: "Athlete") -> float:
    """
    TSS from power data (cycling) or HR-based estimate (running, skiing).
    Returns 0 for non-aerobic activities.
    """
    if activity.training_stress_score is not None:
        return activity.training_stress_score

    duration_hours = activity.duration_seconds / 3600

    if activity.activity_type == "CYCLING" and activity.normalized_power_watts and athlete.ftp_watts:
        if_ = activity.normalized_power_watts / athlete.ftp_watts
        return (activity.duration_seconds * activity.normalized_power_watts * if_) / (athlete.ftp_watts * 3600) * 100

    if activity.avg_heart_rate and athlete.lthr:
        # Skiba HR-based TSS estimate
        hr_fraction = activity.avg_heart_rate / athlete.lthr
        # Exponential penalty for intensity above/below LTHR
        hrss = duration_hours * (hr_fraction ** 4) * 100
        # Scale: moderate run at 0.8 LTHR for 1h ≈ 50 TSS
        if activity.activity_type in ("RUNNING", "XC_SKIING"):
            return min(hrss * 0.65, duration_hours * 120)
        return min(hrss * 0.55, duration_hours * 100)

    # Fallback: rough estimate from duration and activity type
    base_tss_per_hour = {
        "CYCLING": 50,
        "RUNNING": 55,
        "XC_SKIING": 60,
        "HIKING": 25,
        "CLIMBING": 20,
        "STRENGTH": 15,
    }.get(activity.activity_type, 30)

    return base_tss_per_hour * duration_hours


def calculate_daily_loads(activities: list["Activity"], athlete: "Athlete") -> dict[date, float]:
    """Aggregate TSS per calendar day."""
    daily: dict[date, float] = defaultdict(float)
    for act in activities:
        day = act.start_time.date()
        daily[day] += calculate_tss(act, athlete)
    return dict(daily)


def calculate_ctl_atl_tsb(
    daily_loads: dict[date, float],
    days: int = 90,
) -> list[dict]:
    """
    Exponentially weighted ATL/CTL using time constants.
    CTL (chronic): 42-day EWA — fitness
    ATL (acute): 7-day EWA — fatigue
    TSB = CTL - ATL — form/freshness
    """
    end = date.today()
    start = end - timedelta(days=days + CTL_TC)  # extra warm-up period

    ctl_k = 1 - np.exp(-1 / CTL_TC)
    atl_k = 1 - np.exp(-1 / ATL_TC)

    ctl = 0.0
    atl = 0.0
    result = []

    current = start
    while current <= end:
        tss = daily_loads.get(current, 0.0)
        ctl = ctl + ctl_k * (tss - ctl)
        atl = atl + atl_k * (tss - atl)
        tsb = ctl - atl

        # Only return last `days` of data
        if current > end - timedelta(days=days):
            result.append({
                "date": current.isoformat(),
                "ctl": round(ctl, 1),
                "atl": round(atl, 1),
                "tsb": round(tsb, 1),
                "tss": round(tss, 1),
            })
        current += timedelta(days=1)

    return result


def cross_sport_aerobic_transfer(
    activities: list["Activity"],
    athlete: "Athlete",
    window_days: int = 42,
) -> dict[str, float]:
    """
    Compute effective CTL per sport, accounting for aerobic carryover.
    Returns {sport: effective_ctl} for CYCLING, RUNNING, XC_SKIING.
    """
    cutoff = date.today() - timedelta(days=window_days)
    recent = [a for a in activities if a.start_time.date() >= cutoff
              and a.sport_category == "AEROBIC_TRAINING"]

    # Calculate raw CTL per sport
    sport_loads: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    for act in recent:
        day = act.start_time.date()
        sport_loads[act.activity_type][day] += calculate_tss(act, athlete)

    raw_ctl: dict[str, float] = {}
    for sport, loads in sport_loads.items():
        series = calculate_ctl_atl_tsb(dict(loads), days=window_days)
        raw_ctl[sport] = series[-1]["ctl"] if series else 0.0

    # Apply transfer
    target_sports = ["CYCLING", "RUNNING", "XC_SKIING"]
    effective_ctl: dict[str, float] = {}
    for target in target_sports:
        effective = raw_ctl.get(target, 0.0)
        for source, source_ctl in raw_ctl.items():
            if source == target:
                continue
            transfer = TRANSFER_MATRIX.get((source, target), 0.0)
            # Transfer only adds up to the gap — not additive without bound
            contribution = source_ctl * transfer
            effective = max(effective, contribution)  # take the better of direct or transfer
        effective_ctl[target] = round(effective, 1)

    return effective_ctl


_HRV_STATUS_SCORE = {"balanced": 1.0, "unbalanced": 0.5, "low": 0.2}


def calculate_readiness(tsb: float, wellness_rows: list) -> dict:
    """
    Combine TSB + recent wellness signals into a 0-100 readiness score.

    wellness_rows: list of DailyWellness ORM objects, most-recent first.
    """
    tsb_score = max(0.0, min(1.0, (tsb + 30) / 40))
    tsb_points = tsb_score * 40

    bb_points = 0.0
    today_bb = next((w for w in wellness_rows if w.body_battery_max is not None), None)
    if today_bb:
        bb_points = (today_bb.body_battery_max / 100) * 25

    hrv_points = 0.0
    today_hrv = next((w for w in wellness_rows if w.hrv_status is not None), None)
    if today_hrv:
        hrv_points = _HRV_STATUS_SCORE.get((today_hrv.hrv_status or "").lower(), 0.6) * 20

    sleep_points = 0.0
    today_sleep = next((w for w in wellness_rows if w.sleep_score is not None), None)
    if today_sleep:
        sleep_points = (today_sleep.sleep_score / 100) * 15

    max_possible = 40 + (25 if today_bb else 0) + (20 if today_hrv else 0) + (15 if today_sleep else 0)
    total = tsb_points + bb_points + hrv_points + sleep_points
    score = round(total / max_possible * 100)

    if score >= 80:
        zone, guidance = "Peak readiness", "Your body is primed — a quality or race-pace effort will land well today."
    elif score >= 60:
        zone, guidance = "Good to train", "You're recovered and ready. Stick to the plan and execute well."
    elif score >= 40:
        zone, guidance = "Moderate fatigue", "You can train, but keep intensity controlled. Prioritise sleep tonight."
    elif score >= 20:
        zone, guidance = "Carrying fatigue", "Your body is under load. An easy spin or rest day pays more than pushing."
    else:
        zone, guidance = "Rest recommended", "Multiple recovery signals are low. Rest or very light movement only."

    signals: dict = {}
    if today_bb:
        signals["body_battery"] = today_bb.body_battery_max
    if today_hrv:
        signals["hrv_status"] = today_hrv.hrv_status
    if today_sleep:
        signals["sleep_score"] = today_sleep.sleep_score
        if today_sleep.sleep_duration_seconds:
            signals["sleep_hours"] = round(today_sleep.sleep_duration_seconds / 3600, 1)
    rhr_row = next((w for w in wellness_rows if w.resting_heart_rate is not None), None)
    if rhr_row:
        signals["resting_hr"] = rhr_row.resting_heart_rate

    return {"score": score, "zone": zone, "guidance": guidance, "signals": signals}


async def get_fitness_snapshot(
    athlete_id: int,
    db: "AsyncSession",
    include_readiness: bool = False,
    include_wellness: bool = False,
) -> dict:
    """Return {ctl, atl, tsb, readiness?, recent_wellness?} for an athlete."""
    from datetime import date, timedelta
    from sqlalchemy import select, desc
    from app.models.activity import Activity
    from app.models.athlete import Athlete
    from app.models.wellness import DailyWellness

    cutoff = date.today() - timedelta(days=180)
    athlete_result = await db.execute(select(Athlete).where(Athlete.id == athlete_id))
    athlete = athlete_result.scalar_one_or_none()

    acts_result = await db.execute(
        select(Activity)
        .where(Activity.athlete_id == athlete_id, Activity.start_time >= cutoff)
        .order_by(Activity.start_time)
    )
    activities = list(acts_result.scalars().all())

    daily_loads = calculate_daily_loads(activities, athlete)
    series = calculate_ctl_atl_tsb(daily_loads)
    latest = series[-1] if series else {"ctl": 0, "atl": 0, "tsb": 0}

    result: dict = {
        "ctl": latest["ctl"],
        "atl": latest["atl"],
        "tsb": latest["tsb"],
        "_activities": activities,
        "_series": series,
    }

    if include_readiness or include_wellness:
        wellness_result = await db.execute(
            select(DailyWellness)
            .where(
                DailyWellness.athlete_id == athlete_id,
                DailyWellness.date >= date.today() - timedelta(days=7),
            )
            .order_by(desc(DailyWellness.date))
        )
        wellness_rows = list(wellness_result.scalars().all())

        if include_readiness:
            result["readiness"] = calculate_readiness(latest["tsb"], wellness_rows)

        if include_wellness:
            result["recent_wellness"] = [
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

    return result


def estimate_vo2max_trend(activities: list["Activity"], sport: str) -> list[dict]:
    """
    Extracts Garmin-provided VO2max estimates from raw activity data.
    Falls back to a performance-curve estimate when Garmin doesn't provide it.
    """
    trend = []
    sport_acts = [a for a in activities if a.activity_type == sport and a.garmin_raw]

    for act in sorted(sport_acts, key=lambda a: a.start_time):
        raw = act.garmin_raw or {}
        vo2 = raw.get("vo2MaxValue") or raw.get("maxMetValue")
        if vo2:
            trend.append({"date": act.start_time.date().isoformat(), "vo2max": float(vo2)})

    return trend

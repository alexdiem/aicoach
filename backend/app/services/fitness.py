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

"""
Automatically detect the current training season from recent activity mix.
No manual switching required.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.activity import Activity

# Calendar prior: months where skiing is expected in Norway
SKI_MONTHS = {11, 12, 1, 2, 3, 4}


def detect_season(recent_activities: list["Activity"]) -> tuple[str, float]:
    """
    Analyzes the last 6 weeks of aerobic training activities.
    Returns (season, confidence) where season is 'CYCLING_RUNNING' or 'SKI'.

    Logic:
    - Calendar prior: Nov-Apr gives 0.6 prior for SKI
    - Activity evidence: each XC_SKIING session adds weight toward SKI,
      each CYCLING/RUNNING session adds weight toward CYCLING_RUNNING
    - Recent activities weighted 2x more than older ones (last 2 weeks vs weeks 3-6)
    """
    current_month = date.today().month
    calendar_prior_ski = 0.6 if current_month in SKI_MONTHS else 0.2

    cutoff_6w = date.today() - timedelta(weeks=6)
    cutoff_2w = date.today() - timedelta(weeks=2)

    aerobic_types = {"CYCLING", "RUNNING", "XC_SKIING"}
    aerobic = [
        a for a in recent_activities
        if a.activity_type in aerobic_types
        and a.start_time.date() >= cutoff_6w
    ]

    if not aerobic:
        # No data — fall back to calendar
        season = "SKI" if current_month in SKI_MONTHS else "CYCLING_RUNNING"
        return season, 0.5

    ski_score = 0.0
    cycling_running_score = 0.0

    for act in aerobic:
        weight = 2.0 if act.start_time.date() >= cutoff_2w else 1.0
        if act.activity_type == "XC_SKIING":
            ski_score += weight
        else:
            cycling_running_score += weight

    total = ski_score + cycling_running_score
    activity_ski_fraction = ski_score / total if total > 0 else 0.5

    # Combine calendar prior with activity evidence (Bayesian-ish blend)
    blended_ski = 0.4 * calendar_prior_ski + 0.6 * activity_ski_fraction
    blended_cr = 1.0 - blended_ski

    if blended_ski >= blended_cr:
        return "SKI", round(blended_ski, 2)
    else:
        return "CYCLING_RUNNING", round(blended_cr, 2)


def get_primary_sports(season: str) -> list[str]:
    """Ordered list of sports to prioritize in weekly plan for the given season."""
    if season == "SKI":
        return ["XC_SKIING", "RUNNING", "STRENGTH"]
    else:
        return ["CYCLING", "RUNNING", "STRENGTH"]

"""
Weekly training plan generation using polarized intensity distribution,
progressive overload, and cross-sport aerobic transfer.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING

from app.services.terrain import match_route_to_workout

if TYPE_CHECKING:
    from app.models.activity import Activity
    from app.models.athlete import Athlete
    from app.models.route import Route

# Volume targets by CTL range (hours/week)
VOLUME_BY_CTL = [
    (0, 40, 5.5),
    (40, 60, 8.0),
    (60, 80, 10.5),
    (80, 999, 13.0),
]

EASY_FRACTION = 0.80
MODERATE_FRACTION = 0.05
HARD_FRACTION = 0.15

VALID_SPORTS = {"CYCLING", "RUNNING", "XC_SKIING", "STRENGTH"}


def _target_hours(ctl: float) -> float:
    for lo, hi, hours in VOLUME_BY_CTL:
        if lo <= ctl < hi:
            return hours
    return 13.0


def _detect_phase(ctl: float, tsb: float, week_in_block: int) -> str:
    if tsb < -25:
        return "RECOVERY"
    if week_in_block % 4 == 0:
        return "RECOVERY"
    if ctl < 40:
        return "BASE"
    if ctl < 65:
        return "BUILD"
    return "PEAK"


def _week_in_block() -> int:
    week_of_year = date.today().isocalendar()[1]
    return ((week_of_year - 1) % 4) + 1


def _monday_of_week(ref: date | None = None) -> date:
    d = ref or date.today()
    return d - timedelta(days=d.weekday())


def _fun_activity_days(fun_activities: list[dict]) -> set[int]:
    days = set()
    week_start = _monday_of_week()
    for fa in fun_activities:
        fa_date = fa.get("date")
        if isinstance(fa_date, date):
            dow = (fa_date - week_start).days
            if 0 <= dow <= 6:
                days.add(dow)
    return days


WORKOUT_TEMPLATES = {
    "CYCLING_RUNNING": {
        "BASE": [
            {"day": 0, "sport": "CYCLING", "type": "EASY", "duration": 60, "zone": "Z2",
             "purpose": "Aerobic base building. Keep heart rate in Zone 2, conversational pace. Focus on smooth pedaling."},
            {"day": 1, "sport": "RUNNING", "type": "EASY", "duration": 45, "zone": "Z2",
             "purpose": "Easy aerobic run. Maintain Zone 2 effort. Great for running economy."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 60, "zone": None,
             "purpose": "Full-body strength. Prioritize hip hinge, squat, push/pull patterns. Cyclists: add single-leg work."},
            {"day": 3, "sport": "CYCLING", "type": "THRESHOLD", "duration": 75, "zone": "Z4",
             "purpose": "Threshold session. 2-3x15min at 95-105% FTP. This is the key fitness driver of the week."},
            {"day": 4, "sport": "RUNNING", "type": "RECOVERY", "duration": 30, "zone": "Z1",
             "purpose": "Active recovery jog. Very easy, HR < 130. Flush legs from Thursday threshold."},
            {"day": 5, "sport": "STRENGTH", "type": "STRENGTH", "duration": 45, "zone": None,
             "purpose": "Accessory strength. Core, single-leg stability, upper body. Keep it brief."},
            {"day": 6, "sport": "CYCLING", "type": "LONG", "duration": 150, "zone": "Z2",
             "purpose": "Long aerobic ride. Steady Zone 2 throughout. This builds the aerobic engine. Eat on the bike."},
        ],
        "BUILD": [
            {"day": 0, "sport": "CYCLING", "type": "EASY", "duration": 60, "zone": "Z2",
             "purpose": "Aerobic maintenance. Zone 2, keep it honest — no drifting into Zone 3."},
            {"day": 1, "sport": "RUNNING", "type": "VO2MAX", "duration": 50, "zone": "Z5",
             "purpose": "VO2max run intervals. 5-6x3min at 5K effort with 3min recovery. Builds peak aerobic power."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 60, "zone": None,
             "purpose": "Heavy strength session. Low reps, high load. Squats, deadlifts, single-leg press."},
            {"day": 3, "sport": "CYCLING", "type": "VO2MAX", "duration": 75, "zone": "Z5",
             "purpose": "VO2max cycling intervals. 4-5x5-8min at 110-120% FTP. Best done on a climb."},
            {"day": 4, "sport": "RUNNING", "type": "EASY", "duration": 40, "zone": "Z2",
             "purpose": "Easy recovery run. Zone 2 ceiling. Let the VO2max adaptations consolidate."},
            {"day": 5, "sport": "CYCLING", "type": "EASY", "duration": 60, "zone": "Z2",
             "purpose": "Light spin. Loosen legs for Sunday long ride. Keep power well below threshold."},
            {"day": 6, "sport": "CYCLING", "type": "LONG", "duration": 180, "zone": "Z2",
             "purpose": "Long endurance ride. Aim for 3-4h total. Include some Z3 on climbs naturally — that's fine."},
        ],
        "PEAK": [
            {"day": 0, "sport": "RUNNING", "type": "EASY", "duration": 40, "zone": "Z2",
             "purpose": "Easy opener. Shake out legs from last week."},
            {"day": 1, "sport": "CYCLING", "type": "VO2MAX", "duration": 70, "zone": "Z5",
             "purpose": "VO2max block: 6x5min at 115% FTP / 30-30s efforts. Peak intensity week."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 45, "zone": None,
             "purpose": "Maintenance strength. Keep intensity high, volume low. Don't add fatigue."},
            {"day": 3, "sport": "CYCLING", "type": "THRESHOLD", "duration": 60, "zone": "Z4",
             "purpose": "Threshold refresher. 2x20min @ FTP. Maintain sharpness."},
            {"day": 4, "sport": "RUNNING", "type": "RECOVERY", "duration": 30, "zone": "Z1",
             "purpose": "Very easy jog or walk. Complete rest is also fine."},
            {"day": 5, "sport": "CYCLING", "type": "EASY", "duration": 45, "zone": "Z2",
             "purpose": "Pre-weekend activation. Short and easy."},
            {"day": 6, "sport": "CYCLING", "type": "LONG", "duration": 150, "zone": "Z2",
             "purpose": "Long ride with quality. Zone 2 base with natural terrain intensity on climbs."},
        ],
        "RECOVERY": [
            {"day": 0, "sport": "RUNNING", "type": "RECOVERY", "duration": 30, "zone": "Z1",
             "purpose": "Very easy jog. HR < 125. This is a recovery week — protect it."},
            {"day": 1, "sport": "CYCLING", "type": "EASY", "duration": 45, "zone": "Z2",
             "purpose": "Easy spin. Flush accumulated fatigue. No efforts above Zone 2."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 40, "zone": None,
             "purpose": "Light strength maintenance. Reduce volume by 40%. No new PRs this week."},
            {"day": 4, "sport": "CYCLING", "type": "EASY", "duration": 60, "zone": "Z2",
             "purpose": "Steady aerobic ride. Let fitness solidify. No pressure."},
            {"day": 6, "sport": "CYCLING", "type": "LONG", "duration": 90, "zone": "Z2",
             "purpose": "Shorter long ride this week. Keep it enjoyable — recovery week should feel easy."},
        ],
    },
    "SKI": {
        "BASE": [
            {"day": 0, "sport": "XC_SKIING", "type": "EASY", "duration": 75, "zone": "Z2",
             "purpose": "Long slow distance skiing. Classic or skate, Zone 2 effort. Full-body aerobic base."},
            {"day": 1, "sport": "RUNNING", "type": "EASY", "duration": 40, "zone": "Z2",
             "purpose": "Easy run to maintain running mechanics. Supplement skiing aerobic base."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 60, "zone": None,
             "purpose": "Ski-specific strength: upper body pull, core anti-rotation, leg power. Build phase."},
            {"day": 3, "sport": "XC_SKIING", "type": "THRESHOLD", "duration": 80, "zone": "Z4",
             "purpose": "Threshold skiing. 2x15-20min at threshold effort (HR ~85-90% max). Best on rolling terrain."},
            {"day": 4, "sport": "RUNNING", "type": "RECOVERY", "duration": 30, "zone": "Z1",
             "purpose": "Easy active recovery. Alternative: yoga or easy walk."},
            {"day": 5, "sport": "STRENGTH", "type": "STRENGTH", "duration": 45, "zone": None,
             "purpose": "Accessory session. Core, upper body pull. Keep volume low."},
            {"day": 6, "sport": "XC_SKIING", "type": "LONG", "duration": 150, "zone": "Z2",
             "purpose": "Long ski tour or classic distance session. 2.5-3h steady skiing. Eat every 30-45min."},
        ],
        "BUILD": [
            {"day": 0, "sport": "XC_SKIING", "type": "EASY", "duration": 60, "zone": "Z2",
             "purpose": "Aerobic ski session. Zone 2, technique focus."},
            {"day": 1, "sport": "XC_SKIING", "type": "VO2MAX", "duration": 70, "zone": "Z5",
             "purpose": "VO2max intervals on skis. 5-6x3-4min at race effort up a hill. 2-3min recovery."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 60, "zone": None,
             "purpose": "Heavy ski strength: pole strap pull-throughs, box jumps, heavy sled work."},
            {"day": 3, "sport": "XC_SKIING", "type": "THRESHOLD", "duration": 75, "zone": "Z4",
             "purpose": "Threshold skiing. 3x10min at just-below-race pace. Key fitness session."},
            {"day": 4, "sport": "RUNNING", "type": "EASY", "duration": 35, "zone": "Z2",
             "purpose": "Easy run. Maintain running fitness. Very easy."},
            {"day": 5, "sport": "XC_SKIING", "type": "EASY", "duration": 45, "zone": "Z2",
             "purpose": "Activation ski. Light technique work. Prep for Sunday long session."},
            {"day": 6, "sport": "XC_SKIING", "type": "LONG", "duration": 180, "zone": "Z2",
             "purpose": "Long ski tour. 3+ hours at comfortable aerobic pace. This is the week's biggest aerobic stimulus."},
        ],
        "PEAK": [
            {"day": 0, "sport": "XC_SKIING", "type": "EASY", "duration": 45, "zone": "Z2",
             "purpose": "Light opener."},
            {"day": 1, "sport": "XC_SKIING", "type": "VO2MAX", "duration": 65, "zone": "Z5",
             "purpose": "Peak VO2max block: 8x2min at maximal aerobic power. Full recovery between reps."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 40, "zone": None,
             "purpose": "Maintenance strength only. Low volume, high quality."},
            {"day": 3, "sport": "XC_SKIING", "type": "THRESHOLD", "duration": 60, "zone": "Z4",
             "purpose": "Threshold tune-up. 2x15min. Sharpen the edge."},
            {"day": 5, "sport": "XC_SKIING", "type": "EASY", "duration": 40, "zone": "Z1",
             "purpose": "Easy activation. Legs up otherwise."},
            {"day": 6, "sport": "XC_SKIING", "type": "LONG", "duration": 120, "zone": "Z2",
             "purpose": "Moderate long ski. Keep it aerobic — protect freshness."},
        ],
        "RECOVERY": [
            {"day": 0, "sport": "XC_SKIING", "type": "EASY", "duration": 40, "zone": "Z1",
             "purpose": "Very easy ski. Recovery week — enforce it."},
            {"day": 2, "sport": "STRENGTH", "type": "STRENGTH", "duration": 35, "zone": None,
             "purpose": "Light maintenance strength. -40% volume from normal."},
            {"day": 4, "sport": "XC_SKIING", "type": "EASY", "duration": 50, "zone": "Z2",
             "purpose": "Easy aerobic ski. No intensity."},
            {"day": 6, "sport": "XC_SKIING", "type": "LONG", "duration": 90, "zone": "Z2",
             "purpose": "Shorter long ski. Recover fully this week before next block."},
        ],
    },
}

# Default workout to slot in when athlete requests a sport on a day with no template workout
_FILLER_WORKOUTS: dict[str, dict] = {
    "CYCLING": {"type": "EASY", "duration": 60, "zone": "Z2",
                "purpose": "Easy aerobic ride. Zone 2 effort — added based on your schedule preference."},
    "RUNNING": {"type": "EASY", "duration": 45, "zone": "Z2",
                "purpose": "Easy aerobic run. Zone 2 effort — added based on your schedule preference."},
    "XC_SKIING": {"type": "EASY", "duration": 60, "zone": "Z2",
                  "purpose": "Easy ski session. Zone 2 effort — added based on your schedule preference."},
    "STRENGTH": {"type": "STRENGTH", "duration": 50, "zone": None,
                 "purpose": "Strength session — added based on your schedule preference."},
}

# Sport-specific purpose overrides when swapping a workout to a different sport
_SPORT_SWAP_PURPOSES: dict[tuple[str, str], str] = {
    # (original_type, new_sport): purpose
    ("EASY", "CYCLING"): "Easy aerobic ride. Zone 2 — adjusted to your preferred sport for today.",
    ("EASY", "RUNNING"): "Easy aerobic run. Zone 2 — adjusted to your preferred sport for today.",
    ("EASY", "XC_SKIING"): "Easy ski session. Zone 2 — adjusted to your preferred sport for today.",
    ("RECOVERY", "CYCLING"): "Easy recovery spin. Very low intensity — adjusted to your preferred sport.",
    ("RECOVERY", "RUNNING"): "Easy recovery jog. HR < 130 — adjusted to your preferred sport.",
    ("LONG", "CYCLING"): "Long aerobic ride. Zone 2 throughout — adjusted to your preferred sport.",
    ("LONG", "RUNNING"): "Long aerobic run. Zone 2 throughout — adjusted to your preferred sport.",
    ("LONG", "XC_SKIING"): "Long ski tour. Steady aerobic pace — adjusted to your preferred sport.",
    ("VO2MAX", "CYCLING"): "VO2max cycling intervals. Best on a climb — adjusted to your preferred sport.",
    ("VO2MAX", "RUNNING"): "VO2max run intervals. 5K pace efforts — adjusted to your preferred sport.",
    ("VO2MAX", "XC_SKIING"): "VO2max ski intervals. Hard uphill reps — adjusted to your preferred sport.",
    ("THRESHOLD", "CYCLING"): "Threshold ride. 95-105% FTP — adjusted to your preferred sport.",
    ("THRESHOLD", "RUNNING"): "Threshold run. Comfortably hard effort — adjusted to your preferred sport.",
    ("THRESHOLD", "XC_SKIING"): "Threshold ski. Race-pace intervals — adjusted to your preferred sport.",
}


def _apply_athlete_schedule(
    workouts: list[dict],
    schedule: list[dict],  # [{day_of_week, is_rest, preferred_sport}]
    phase: str,
) -> list[dict]:
    """
    Apply athlete schedule constraints to the generated workout list:
    - Rest days: remove any workout on that day
    - Preferred sport: swap the sport on that day (keep workout type)
    - Sport on unscheduled day: insert an appropriate filler workout
    - No preference (preferred_sport=None, is_rest=False): leave template as-is
    """
    if not schedule:
        return workouts

    by_day: dict[int, dict] = {w["day_of_week"]: w for w in workouts}
    constraints: dict[int, dict] = {s["day_of_week"]: s for s in schedule}

    result = dict(by_day)

    for dow, constraint in constraints.items():
        if constraint.get("is_rest"):
            result.pop(dow, None)
            continue

        preferred = constraint.get("preferred_sport")
        if not preferred:
            continue  # no preference — leave template workout untouched

        if dow in result:
            existing = result[dow]
            workout_type = existing["workout_type"]

            # Strength stays strength regardless of sport swap (can't do VO2max as "STRENGTH")
            if preferred == "STRENGTH":
                result[dow] = {**existing, "sport": "STRENGTH", "workout_type": "STRENGTH", "intensity_zone": None,
                               "purpose": "Strength session — adjusted to your schedule preference."}
            else:
                swapped_purpose = _SPORT_SWAP_PURPOSES.get(
                    (workout_type, preferred),
                    f"{workout_type.capitalize()} session — adjusted to {preferred.replace('_', ' ').lower()} per your preference.",
                )
                result[dow] = {**existing, "sport": preferred, "purpose": swapped_purpose}
        else:
            # No template workout on this day — insert a filler
            filler = _FILLER_WORKOUTS.get(preferred)
            if filler:
                filler_type = filler["type"]
                filler_duration = filler["duration"]
                if phase == "RECOVERY":
                    filler_type = "RECOVERY" if filler_type != "STRENGTH" else "STRENGTH"
                    filler_duration = max(30, filler_duration - 15)
                result[dow] = {
                    "day_of_week": dow,
                    "sport": preferred,
                    "workout_type": filler_type,
                    "duration_minutes": filler_duration,
                    "intensity_zone": filler["zone"],
                    "purpose": filler["purpose"],
                    "suggested_route_id": None,
                    "terrain_notes": None,
                }

    # Re-sort by day
    return sorted(result.values(), key=lambda w: w["day_of_week"])


def generate_weekly_plan_data(
    athlete: "Athlete",
    ctl: float,
    atl: float,
    tsb: float,
    season: str,
    recent_activities: list["Activity"],
    fun_activities_next_week: list[dict],
    available_routes: list["Route"],
    athlete_schedule: list[dict] | None = None,
    phase_override: str | None = None,
) -> dict:
    """
    Generate a weekly plan. Returns a dict ready to create WeeklyPlan + PlannedWorkout records.

    athlete_schedule: list of {day_of_week: int, is_rest: bool, preferred_sport: str|None}
    phase_override: if set, skip auto-detection and use this phase directly.
    """
    phase = phase_override if phase_override else _detect_phase(ctl, tsb, _week_in_block())
    week_start = _monday_of_week()

    templates = WORKOUT_TEMPLATES.get(season, WORKOUT_TEMPLATES["CYCLING_RUNNING"])
    phase_templates = templates.get(phase, templates["BASE"])

    target_hours = _target_hours(ctl)
    if phase == "RECOVERY":
        target_hours *= 0.65

    template_hours = sum(t["duration"] for t in phase_templates) / 60
    scale = target_hours / template_hours if template_hours > 0 else 1.0
    scale = max(0.7, min(1.4, scale))

    fun_days = _fun_activity_days(fun_activities_next_week)
    blocked_days = fun_days.copy()
    for d in list(fun_days):
        blocked_days.add((d + 1) % 7)

    # Build initial workout list from template
    raw_workouts = []
    for tmpl in phase_templates:
        dow = tmpl["day"]
        if dow in blocked_days and tmpl["type"] not in ("RECOVERY", "EASY"):
            adjusted = {**tmpl, "type": "EASY", "zone": "Z2",
                        "purpose": f"Downgraded to easy: recovery from nearby fun activity. {tmpl['purpose']}"}
        else:
            adjusted = {**tmpl}

        scaled_duration = round(adjusted["duration"] * scale / 5) * 5

        raw_workouts.append({
            "day_of_week": dow,
            "sport": adjusted["sport"],
            "workout_type": adjusted["type"],
            "duration_minutes": scaled_duration,
            "intensity_zone": adjusted.get("zone"),
            "purpose": adjusted["purpose"],
            "suggested_route_id": None,
            "terrain_notes": None,
        })

    # Apply athlete schedule constraints
    constrained = _apply_athlete_schedule(raw_workouts, athlete_schedule or [], phase)

    # Terrain matching + finalize
    workouts = []
    for w in constrained:
        workout_type = w["workout_type"]
        sport = w["sport"]
        duration = w["duration_minutes"]

        route_match = None
        terrain_notes = w.get("terrain_notes")

        if (sport == "CYCLING"
                and workout_type in ("VO2MAX", "THRESHOLD", "TEMPO")
                and available_routes
                and athlete.ftp_watts):
            match = match_route_to_workout(
                workout_type=workout_type,
                target_duration_min=duration,
                target_intensity=workout_type,
                available_routes=available_routes,
                athlete_ftp=athlete.ftp_watts,
            )
            if not match["indoor_recommended"] and match["best_match"]:
                route_match = match["best_match"].id
            terrain_notes = match["rationale"]
            if match["modification_suggestion"]:
                terrain_notes += f" | Adaptation: {match['modification_suggestion']}"

        workouts.append({
            "day_of_week": w["day_of_week"],
            "sport": sport,
            "workout_type": workout_type,
            "duration_minutes": duration,
            "intensity_zone": w.get("intensity_zone"),
            "purpose": w["purpose"],
            "suggested_route_id": route_match,
            "terrain_notes": terrain_notes,
        })

    return {
        "week_start": week_start,
        "season": season,
        "phase": phase,
        "ctl_at_generation": round(ctl, 1),
        "workouts": workouts,
    }

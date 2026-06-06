"""
Rule-based structured workout session builder.
Converts workout_type + duration + athlete thresholds into a warmup/interval/cooldown plan.

Two modes:
- No route (or route with no segments): traditional interval session with generic targets.
- Route with climb segments: ride-the-full-route session structured around each climb,
  with a realistic time estimate from distance + elevation data.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.route import Route


def build_structured_session(
    workout_type: str,
    duration_minutes: int,
    sport: str,
    athlete_ftp: float | None = None,
    athlete_lthr: float | None = None,
    route: "Route | None" = None,
) -> dict:
    if sport == "STRENGTH" or workout_type == "STRENGTH":
        return _build_strength(duration_minutes)
    if workout_type in ("EASY", "RECOVERY"):
        return _build_easy(duration_minutes, sport, route)
    if workout_type == "LONG":
        return _build_long(duration_minutes, sport, route)

    # For structured workouts (VO2MAX / THRESHOLD / TEMPO) on a cycling route:
    # build a ride-the-route session instead of repeat intervals.
    if sport == "CYCLING" and _has_route_segments(route):
        return _build_route_ride(workout_type, sport, athlete_ftp, athlete_lthr, route)

    if workout_type == "VO2MAX":
        return _build_vo2max_intervals(duration_minutes, sport, athlete_ftp, athlete_lthr)
    if workout_type == "THRESHOLD":
        return _build_threshold_intervals(duration_minutes, sport, athlete_ftp, athlete_lthr)
    if workout_type == "TEMPO":
        return _build_tempo_intervals(duration_minutes, sport, athlete_ftp, athlete_lthr)
    return _build_easy(duration_minutes, sport, route)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _has_route_segments(route: "Route | None") -> bool:
    return bool(route and route.analysis and route.analysis.get("segments"))


def _warmup_cooldown(duration_minutes: int) -> tuple[int, int]:
    if duration_minutes >= 75:
        return 15, 12
    if duration_minutes >= 60:
        return 12, 10
    if duration_minutes >= 45:
        return 10, 8
    return 8, 7


def _ftp_target(pct_lo: int, pct_hi: int, ftp: float | None) -> str:
    if ftp:
        return f"{round(ftp * pct_lo / 100)}–{round(ftp * pct_hi / 100)} W ({pct_lo}–{pct_hi}% FTP)"
    return f"{pct_lo}–{pct_hi}% FTP"


def _hr_target(pct_lo: int, pct_hi: int, lthr: float | None, zone: str) -> str:
    if lthr:
        return f"{round(lthr * pct_lo / 100)}–{round(lthr * pct_hi / 100)} bpm ({zone})"
    return zone


def _estimate_route_time_min(dist_km: float, gain_m: float) -> int:
    """
    Estimate cycling time at Z2 endurance pace using two components:
      flat time  = distance / 28 km/h
      climb time = elevation / 750 m/hr VAM  (typical Z2 climbing rate)
    The formula doesn't double-count because the climb component represents
    the additional time lost to gravity beyond flat rolling speed.
    """
    flat_min = dist_km / 28 * 60
    climb_min = gain_m / 750 * 60
    return max(30, round(flat_min + climb_min))


def _make_session(warmup_min, warmup_notes, intervals, cooldown_min, cooldown_notes, route):
    total = warmup_min + sum(i["duration_minutes"] for i in intervals) + cooldown_min
    return {
        "warmup_minutes": warmup_min,
        "warmup_notes": warmup_notes,
        "intervals": intervals,
        "cooldown_minutes": cooldown_min,
        "cooldown_notes": cooldown_notes,
        "route_id": route.id if route else None,
        "route_name": route.name if route else None,
        "total_duration_minutes": total,
    }


# ─── Route-ride builder (full route, climb-by-climb) ──────────────────────────

def _build_route_ride(workout_type: str, sport: str, ftp: float | None, lthr: float | None, route: "Route") -> dict:
    """
    Build a session for riding the complete route.
    Each climb segment becomes a timed effort; flat/descent sections between
    them are marked as Z2 recovery. Total duration is estimated from the
    actual route distance and elevation, not the plan template.
    """
    analysis = route.analysis or {}
    dist_km = analysis.get("total_distance_m", 0) / 1000
    gain_m = analysis.get("total_gain_m", 0)
    all_segments = sorted(analysis.get("segments", []), key=lambda s: s.get("start_km", 0))

    estimated_total = _estimate_route_time_min(dist_km, gain_m)

    # Decide which climbs get hard efforts vs stay easy, based on workout type
    if workout_type == "VO2MAX":
        hard_cats = {"SHORT_PUNCH", "MEDIUM_CLIMB"}
        easy_cats = {"LONG_CLIMB"}
        hard_target = _ftp_target(110, 120, ftp)
        easy_target = _ftp_target(85, 92, ftp)
        hard_label = "VO2max — breathe hard, hold form"
        easy_label = "Too long for VO2max — settle into threshold/Z4"
    elif workout_type == "THRESHOLD":
        hard_cats = {"LONG_CLIMB", "MEDIUM_CLIMB"}
        easy_cats = {"SHORT_PUNCH"}
        hard_target = _ftp_target(95, 105, ftp)
        easy_target = _ftp_target(105, 115, ftp)
        hard_label = "Threshold — comfortably hard, hold steady power"
        easy_label = "Short punch — can go over threshold briefly"
    else:  # TEMPO
        hard_cats = {"LONG_CLIMB", "MEDIUM_CLIMB", "SHORT_PUNCH"}
        easy_cats = set()
        hard_target = _ftp_target(88, 93, ftp)
        easy_target = hard_target
        hard_label = "Steady tempo — not easy, not a struggle"
        easy_label = hard_label

    hard_segs = [s for s in all_segments if s["category"] in hard_cats]
    hard_rep_count = len(hard_segs)

    # Warmup: time from start to first climb (or first ~5km, whichever is less)
    first_km = all_segments[0]["start_km"] if all_segments else dist_km * 0.2
    warmup_min = max(8, round(min(first_km, 8.0) / 28 * 60))
    warmup_notes = (
        f"First {first_km:.1f} km at Z2 to warm up the legs. "
        "Build cadence and settle into a rhythm before the first climb."
    )

    intervals = []
    prev_end_km = first_km
    hard_rep = 0

    for seg in all_segments:
        # Gap between previous segment end and this segment start
        gap_km = seg["start_km"] - prev_end_km
        if gap_km > 0.3:
            gap_min = max(2, round(gap_km / 32 * 60))  # ~32 km/h on descent/flat
            intervals.append({
                "type": "rest",
                "duration_minutes": gap_min,
                "notes": (
                    f"Km {prev_end_km:.1f} → {seg['start_km']:.1f}: "
                    "Z2 / recovery. Descend, recover HR, take a drink."
                ),
            })

        is_hard = seg["category"] in hard_cats
        if is_hard:
            hard_rep += 1
        dur = max(1, round(seg["est_duration_at_ftp_min"]))
        target = hard_target if is_hard else easy_target
        label = hard_label if is_hard else easy_label

        length_str = (
            f"{seg['length_meters'] / 1000:.1f} km"
            if seg["length_meters"] >= 1000
            else f"{seg['length_meters']} m"
        )

        step: dict = {
            "type": "work" if is_hard else "rest",
            "duration_minutes": dur,
            "target": target,
            "notes": (
                f"Km {seg['start_km']:.1f}: {seg['category'].replace('_', ' ').title()} — "
                f"{length_str} at {seg['avg_gradient_pct']}% avg. {label}."
            ),
            "segment": seg,
        }
        if is_hard:
            step["rep"] = hard_rep
            step["total_reps"] = hard_rep_count

        intervals.append(step)
        prev_end_km = seg["end_km"]

    # Cooldown: remainder of route after last climb
    remaining_km = dist_km - prev_end_km
    cooldown_min = max(5, round(remaining_km / 32 * 60))
    cooldown_notes = (
        f"Final {remaining_km:.1f} km at Z2 — spin out, let HR drop, enjoy the finish."
    )

    session = _make_session(warmup_min, warmup_notes, intervals, cooldown_min, cooldown_notes, route)
    # Override total to the realistic route estimate (warmup + intervals ≠ full ride)
    session["total_duration_minutes"] = estimated_total
    session["route_summary"] = {
        "distance_km": round(dist_km, 1),
        "elevation_gain_m": round(gain_m),
        "estimated_minutes": estimated_total,
    }
    return session


# ─── Interval builders (no route) ─────────────────────────────────────────────

def _build_vo2max_intervals(duration_minutes: int, sport: str, ftp: float | None, lthr: float | None) -> dict:
    warmup, cooldown = _warmup_cooldown(duration_minutes)
    available = duration_minutes - warmup - cooldown

    if sport == "CYCLING":
        interval_min = 6 if available < 35 else 8
        rest_min = 4
        target = _ftp_target(110, 120, ftp)
        warmup_notes = "Easy spin building cadence. Include 2–3 × 20s openers in the last 3 min to prime the system."
        work_notes = "Hard but controlled — breathe hard, hold form, don't sprint."
        rest_notes = "Easy spin. Full recovery before next rep."
        cooldown_notes = "Easy spin to flush the legs."
    elif sport == "RUNNING":
        interval_min, rest_min = 3, 3
        target = "5K race effort" if not lthr else f"≥{round(lthr * 0.97)} bpm"
        warmup_notes = "Easy jog building pace. Include 4 × 20s strides in the last 2 min."
        work_notes = "Hard but controlled — hold pace, don't sprint the first rep."
        rest_notes = "Easy jog or walk. Let HR drop below Z3."
        cooldown_notes = "Easy jog, gradually slowing."
    else:
        interval_min, rest_min = 4, 3
        target = "Race effort / near-max HR"
        warmup_notes = "Easy skiing. Include 2 short hard uphill efforts to open up."
        work_notes = "Maximal uphill — technique can open up."
        rest_notes = "Easy glide. Recover fully."
        cooldown_notes = "Easy skiing to flush arms and legs."

    reps = max(3, min(8, available // (interval_min + rest_min)))
    intervals = []
    for i in range(reps):
        intervals.append({"type": "work", "rep": i + 1, "total_reps": reps,
                          "duration_minutes": interval_min, "target": target,
                          "notes": work_notes, "segment": None})
        if i < reps - 1:
            intervals.append({"type": "rest", "duration_minutes": rest_min,
                               "notes": rest_notes, "segment": None})

    return _make_session(warmup, warmup_notes, intervals, cooldown, cooldown_notes, None)


def _build_threshold_intervals(duration_minutes: int, sport: str, ftp: float | None, lthr: float | None) -> dict:
    warmup, cooldown = _warmup_cooldown(duration_minutes)
    available = duration_minutes - warmup - cooldown

    if sport == "CYCLING":
        if available >= 45:
            interval_min, rest_min, reps = 20, 5, 2
        elif available >= 30:
            interval_min, rest_min, reps = 15, 5, 2
        else:
            interval_min, rest_min, reps = available, 0, 1
        target = _ftp_target(95, 105, ftp)
        warmup_notes = "Easy spin building to Z3. Last 3 min at tempo to prime the threshold system."
        work_notes = "Comfortably hard — speak in short sentences. Steady power, don't surge."
        rest_notes = "Easy spin. Let HR drop but keep moving."
        cooldown_notes = "Easy spin to bring HR down gradually."
    elif sport == "RUNNING":
        if available >= 40:
            interval_min, rest_min, reps = 20, 3, 2
        else:
            interval_min, rest_min, reps = max(15, available), 0, 1
        target = _hr_target(85, 92, lthr, "Z4 — comfortably hard")
        warmup_notes = "Easy jog building to threshold pace."
        work_notes = "Threshold pace — a few words possible, not sentences."
        rest_notes = "Easy jog between reps."
        cooldown_notes = "Easy jog, gradually reducing pace."
    else:
        interval_min = 15 if available >= 35 else 10
        rest_min = 5
        reps = max(1, available // (interval_min + rest_min))
        target = "85–92% max HR"
        warmup_notes = "Easy skiing building to threshold effort."
        work_notes = "Sustained — focus on technique as fatigue builds."
        rest_notes = "Easy glide."
        cooldown_notes = "Easy skiing."

    intervals = []
    for i in range(reps):
        intervals.append({"type": "work", "rep": i + 1, "total_reps": reps,
                          "duration_minutes": interval_min, "target": target,
                          "notes": work_notes, "segment": None})
        if i < reps - 1 and rest_min > 0:
            intervals.append({"type": "rest", "duration_minutes": rest_min,
                               "notes": rest_notes, "segment": None})

    return _make_session(warmup, warmup_notes, intervals, cooldown, cooldown_notes, None)


def _build_tempo_intervals(duration_minutes: int, sport: str, ftp: float | None, lthr: float | None) -> dict:
    warmup, cooldown = _warmup_cooldown(duration_minutes)
    available = duration_minutes - warmup - cooldown
    target = _ftp_target(88, 93, ftp) if sport == "CYCLING" else _hr_target(80, 87, lthr, "Z3")
    intervals = [{"type": "work", "rep": 1, "total_reps": 1, "duration_minutes": available,
                  "target": target, "notes": "Steady tempo — not easy, not a struggle. Hold even effort.",
                  "segment": None}]
    return _make_session(warmup, "Build to tempo pace over the warmup.",
                         intervals, cooldown, "Easy effort to bring HR down.", None)


# ─── Other builders ───────────────────────────────────────────────────────────

def _build_long(duration_minutes: int, sport: str, route: "Route | None") -> dict:
    warmup, cooldown = 10, 10
    label = {"CYCLING": "ride", "RUNNING": "run", "XC_SKIING": "ski session"}.get(sport, "session")
    analysis = route.analysis if route and route.analysis else {}
    dist_km = analysis.get("total_distance_m", 0) / 1000
    gain_m = analysis.get("total_gain_m", 0)
    estimated_total = _estimate_route_time_min(dist_km, gain_m) if dist_km else duration_minutes

    notes = (
        f"Steady Zone 2 {label}. Fully conversational throughout — back off on climbs to stay in Z2. "
        "Eat every 30–45 min. This session builds the aerobic engine."
    )
    if dist_km:
        notes = (
            f"Ride the full {dist_km:.0f} km route at Z2 (est. {estimated_total} min). "
            "Stay conversational on every climb — resistance is fine, suffering is not. "
            "Eat every 30–45 min."
        )

    intervals = [{"type": "work", "rep": 1, "total_reps": 1,
                  "duration_minutes": (estimated_total - warmup - cooldown) if dist_km else (duration_minutes - warmup - cooldown),
                  "target": "Z2 — fully conversational throughout",
                  "notes": notes, "segment": None}]

    session = _make_session(warmup, "Start easy — settle into aerobic pace over the first 10 min.",
                            intervals, cooldown, "Easy final km to flush legs.",
                            route)
    if dist_km:
        session["total_duration_minutes"] = estimated_total
        session["route_summary"] = {"distance_km": round(dist_km, 1),
                                    "elevation_gain_m": round(gain_m),
                                    "estimated_minutes": estimated_total}
    return session


def _build_easy(duration_minutes: int, sport: str, route: "Route | None") -> dict:
    label = {"CYCLING": "ride", "RUNNING": "run", "XC_SKIING": "ski"}.get(sport, "session")
    analysis = route.analysis if route and route.analysis else {}
    dist_km = analysis.get("total_distance_m", 0) / 1000
    gain_m = analysis.get("total_gain_m", 0)
    estimated_total = _estimate_route_time_min(dist_km, gain_m) if dist_km else duration_minutes

    notes = (
        f"Easy {label}. Heart rate well below threshold — no laboured breathing. "
        "Don't let enthusiasm push you into Z3."
    )
    if dist_km:
        notes = (
            f"Easy {label} of the full {dist_km:.0f} km route (est. {estimated_total} min). "
            "Z1–Z2 throughout — back off on every climb to stay aerobic."
        )

    session = {
        "warmup_minutes": 0, "warmup_notes": None,
        "intervals": [{"type": "work", "rep": 1, "total_reps": 1,
                       "duration_minutes": estimated_total,
                       "target": "Z1–Z2 — easy, fully conversational",
                       "notes": notes, "segment": None}],
        "cooldown_minutes": 0, "cooldown_notes": None,
        "route_id": route.id if route else None,
        "route_name": route.name if route else None,
        "total_duration_minutes": estimated_total,
    }
    if dist_km:
        session["route_summary"] = {"distance_km": round(dist_km, 1),
                                    "elevation_gain_m": round(gain_m),
                                    "estimated_minutes": estimated_total}
    return session


def _build_strength(duration_minutes: int) -> dict:
    available = duration_minutes - 10 - 8
    exercises = [
        ("Hip hinge",       "Deadlift or RDL — 4 × 6 @ 80–85% 1RM. Neutral spine, hamstring tension."),
        ("Squat pattern",   "Back squat or goblet squat — 4 × 8. Full depth, controlled descent."),
        ("Single-leg",      "Step-up or split squat — 3 × 10 each leg. Add load progressively."),
        ("Upper body pull", "Row or pull-up — 3 × 10. Scapulae engaged throughout."),
        ("Core",            "Pallof press or dead bug — 3 × 12. Anti-rotation, slow and controlled."),
    ]
    n = max(2, min(len(exercises), available // 8))
    intervals = [
        {"type": "work", "rep": 1, "total_reps": 1, "duration_minutes": 10,
         "target": "Activation", "notes": "Hip circles, leg swings, thoracic rotations, band pull-aparts.", "segment": None},
        *[{"type": "work", "rep": i + 1, "total_reps": n,
           "duration_minutes": max(6, available // n),
           "target": name, "notes": desc, "segment": None}
          for i, (name, desc) in enumerate(exercises[:n])],
        {"type": "work", "rep": 1, "total_reps": 1, "duration_minutes": 8,
         "target": "Mobility cooldown",
         "notes": "Hip flexor, pigeon, lat stretch, couch stretch — 60–90s each.", "segment": None},
    ]
    return {
        "warmup_minutes": 0, "warmup_notes": None,
        "intervals": intervals,
        "cooldown_minutes": 0, "cooldown_notes": None,
        "route_id": None, "route_name": None,
        "total_duration_minutes": duration_minutes,
    }

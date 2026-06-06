"""
Rule-based structured workout session builder.
Converts workout_type + duration + athlete thresholds into a warmup/interval/cooldown plan.

Two modes:
- No route (or route with no segments): traditional interval session with generic targets.
- Route with climb segments: ride-the-full-route session. The athlete always completes
  the whole route. The structured workout is carved into the section of terrain best
  suited to it; everything else is Z2 free riding. duration_minutes controls how much
  hard work is targeted — it does NOT limit total ride time.
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
        return _build_route_ride(workout_type, duration_minutes, sport, athlete_ftp, athlete_lthr, route)

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


def _merge_consecutive_rests(intervals: list[dict]) -> list[dict]:
    """Collapse adjacent REST steps into a single step."""
    merged: list[dict] = []
    for step in intervals:
        if merged and step["type"] == "rest" and merged[-1]["type"] == "rest":
            prev = merged[-1]
            prev["duration_minutes"] += step["duration_minutes"]
            # Keep notes from whichever is more informative (longest)
            if len(step.get("notes", "")) > len(prev.get("notes", "")):
                prev["notes"] = step["notes"]
        else:
            merged.append(dict(step))
    return merged


def _make_session(warmup_min, warmup_notes, intervals, cooldown_min, cooldown_notes, route):
    merged = _merge_consecutive_rests(intervals)
    total = warmup_min + sum(i["duration_minutes"] for i in merged) + cooldown_min
    return {
        "warmup_minutes": warmup_min,
        "warmup_notes": warmup_notes,
        "intervals": merged,
        "cooldown_minutes": cooldown_min,
        "cooldown_notes": cooldown_notes,
        "route_id": route.id if route else None,
        "route_name": route.name if route else None,
        "total_duration_minutes": total,
    }


# ─── Route-ride builder (full route, workout carved into best section) ───────

# Maximum rest (in minutes) between hard efforts for each workout type.
# Gaps larger than this mean the climbs are too far apart to form a coherent session.
_MAX_REST_BETWEEN_EFFORTS: dict[str, float] = {
    "VO2MAX": 8.0,     # ~1:1 work-to-rest; 6min effort → 6-8min recovery
    "THRESHOLD": 12.0, # sustained work benefits from longer rest, but not endless
    "TEMPO": 20.0,     # lower intensity, wider tolerance
}
_DESCENT_SPEED_KMH = 32.0  # speed used to estimate gap/descent time


def _gap_minutes(end_km: float, start_km: float) -> float:
    return max(0.0, (start_km - end_km) / _DESCENT_SPEED_KMH * 60)


def _find_best_cluster(
    primary_candidates: list[dict],
    hard_budget_min: float,
    max_rest_min: float,
    rank_fn,
) -> list[dict]:
    """
    Find the best cluster of consecutive primary segments where no adjacent gap
    exceeds max_rest_min and total hard-effort time fits within hard_budget_min.

    Algorithm:
      1. Sort candidates by route position.
      2. Split into clusters wherever the gap between consecutive candidates
         exceeds max_rest_min.
      3. For each cluster, take the top-ranked segments that fit the budget.
      4. Return the cluster with the most total hard-effort time (best stimulus).
    """
    if not primary_candidates:
        return []

    by_pos = sorted(primary_candidates, key=lambda s: s["start_km"])

    # Split into clusters
    clusters: list[list[dict]] = [[by_pos[0]]]
    for seg in by_pos[1:]:
        gap = _gap_minutes(clusters[-1][-1]["end_km"], seg["start_km"])
        if gap <= max_rest_min:
            clusters[-1].append(seg)
        else:
            clusters.append([seg])

    # For each cluster, greedily pick top-ranked segments up to budget
    best: list[dict] = []
    best_work = 0.0

    for cluster in clusters:
        ranked = sorted(cluster, key=rank_fn)
        selected: list[dict] = []
        work = 0.0
        for seg in ranked:
            t = seg["est_duration_at_ftp_min"]
            if work + t <= hard_budget_min:
                selected.append(seg)
                work += t
        if work > best_work:
            best_work = work
            best = selected

    return best


def _build_route_ride(workout_type: str, duration_minutes: int, sport: str, ftp: float | None, lthr: float | None, route: "Route") -> dict:
    """
    The athlete always completes the full route.

    The structured workout is carved into the section of the route that contains
    the best cluster of suitable climbs — i.e. climbs close enough together that
    the recovery rides between them are short and intentional, not exhausting
    free-rides. Everything outside the cluster is pure free riding.

    Selection logic per workout type:
      VO2MAX    → SHORT_PUNCH / MEDIUM_CLIMB (closest to 6 min); max 8 min gap
      THRESHOLD → LONG_CLIMB / MEDIUM_CLIMB  (longest duration first); max 12 min gap
      TEMPO     → all climbs in route order; max 20 min gap
    """
    analysis = route.analysis or {}
    dist_km = analysis.get("total_distance_m", 0) / 1000
    gain_m = analysis.get("total_gain_m", 0)
    all_segments = sorted(analysis.get("segments", []), key=lambda s: s.get("start_km", 0))
    estimated_total = _estimate_route_time_min(dist_km, gain_m)

    max_rest_min = _MAX_REST_BETWEEN_EFFORTS.get(workout_type, 12.0)

    # ── Workout configuration by type ────────────────────────────────────────
    if workout_type == "VO2MAX":
        primary_cats = {"SHORT_PUNCH", "MEDIUM_CLIMB"}
        secondary_cats = {"LONG_CLIMB"}
        primary_target = _ftp_target(110, 120, ftp)
        primary_label = "VO2max — breathe hard, hold form"
        secondary_target = _ftp_target(80, 87, ftp)
        secondary_label = "Long climb — stay Z2/Z3, save the legs"
        def _rank(s): return abs(s["est_duration_at_ftp_min"] - 6)  # closest to 6 min ideal
    elif workout_type == "THRESHOLD":
        primary_cats = {"LONG_CLIMB", "MEDIUM_CLIMB"}
        secondary_cats = {"SHORT_PUNCH"}
        primary_target = _ftp_target(95, 105, ftp)
        primary_label = "Threshold — comfortably hard, steady power"
        secondary_target = _ftp_target(80, 88, ftp)
        secondary_label = "Short punch — controlled, don't blow up"
        def _rank(s): return -s["est_duration_at_ftp_min"]  # longest first
    else:  # TEMPO
        primary_cats = {"LONG_CLIMB", "MEDIUM_CLIMB", "SHORT_PUNCH"}
        secondary_cats: set = set()
        primary_target = _ftp_target(88, 93, ftp)
        primary_label = "Steady tempo — not easy, not a struggle"
        secondary_target = primary_target
        secondary_label = primary_label
        def _rank(s): return s.get("start_km", 0)  # ride in order

    # ── Select a coherent cluster of hard segments ────────────────────────────
    primary_candidates = [s for s in all_segments if s["category"] in primary_cats]
    hard_budget_min = duration_minutes * 0.60
    selected_primary = _find_best_cluster(primary_candidates, hard_budget_min, max_rest_min, _rank)
    selected_primary_ids = {id(s) for s in selected_primary}

    # Determine the geographic bounds of the structured section
    cluster_start_km = selected_primary[0]["start_km"] if selected_primary else None
    cluster_end_km   = selected_primary[-1]["end_km"]   if selected_primary else None

    # Warmup = free ride from start to first selected hard climb
    first_km = all_segments[0]["start_km"] if all_segments else dist_km * 0.1
    warmup_min = max(8, round(min(first_km, 10.0) / 28 * 60))

    if cluster_start_km is not None and cluster_start_km > first_km + 1.0:
        ride_in_km = cluster_start_km - first_km
        ride_in_min = max(5, round(ride_in_km / _DESCENT_SPEED_KMH * 60))
        warmup_notes = (
            f"First {first_km:.1f} km at Z2 to warm up. "
            f"Then free ride {ride_in_min} min to the workout section (km {cluster_start_km:.1f})."
        )
    else:
        warmup_notes = (
            f"First {first_km:.1f} km at easy Z2 — settle in before the terrain starts."
        )

    # ── Build interval list walking the route in km order ────────────────────
    intervals: list[dict] = []
    prev_end_km = first_km
    hard_rep = 0
    hard_rep_count = len(selected_primary)

    for seg in all_segments:
        gap_km = seg["start_km"] - prev_end_km
        if gap_km > 0.5:
            gap_min = max(2, round(gap_km / _DESCENT_SPEED_KMH * 60))
            # Label the gap: structured recovery if inside the cluster, free ride if outside
            inside_cluster = (
                cluster_start_km is not None
                and prev_end_km >= cluster_start_km - 0.1
                and seg["start_km"] <= cluster_end_km + 0.1
            )
            if inside_cluster:
                gap_label = f"Recovery — {gap_min} min easy spin before next climb. Drink, breathe."
            else:
                gap_label = (
                    f"Km {prev_end_km:.1f}→{seg['start_km']:.1f}: free ride / Z2. "
                    "No structured effort here — enjoy the scenery."
                )
            intervals.append({"type": "rest", "duration_minutes": gap_min, "notes": gap_label})

        is_hard = id(seg) in selected_primary_ids
        is_secondary = (not is_hard) and seg["category"] in secondary_cats

        dur = max(1, round(seg["est_duration_at_ftp_min"]))
        length_str = (
            f"{seg['length_meters'] / 1000:.1f} km"
            if seg["length_meters"] >= 1000
            else f"{seg['length_meters']} m"
        )
        cat_label = seg["category"].replace("_", " ").title()
        base_desc = f"Km {seg['start_km']:.1f}: {cat_label} — {length_str} at {seg['avg_gradient_pct']}% avg."

        if is_hard:
            hard_rep += 1
            step: dict = {
                "type": "work",
                "rep": hard_rep,
                "total_reps": hard_rep_count,
                "duration_minutes": dur,
                "target": primary_target,
                "notes": f"{base_desc} {primary_label}.",
                "segment": seg,
            }
        elif is_secondary and id(seg) in {id(s) for s in all_segments
                                          if cluster_start_km is not None
                                          and s["start_km"] >= cluster_start_km
                                          and s["end_km"] <= cluster_end_km + 0.1}:
            step = {
                "type": "rest",
                "duration_minutes": dur,
                "target": secondary_target,
                "notes": f"{base_desc} {secondary_label}.",
                "segment": seg,
            }
        else:
            step = {
                "type": "rest",
                "duration_minutes": dur,
                "notes": f"{base_desc} Free ride / Z2 — not part of the structured block.",
                "segment": seg,
            }

        intervals.append(step)
        prev_end_km = seg["end_km"]

    # Remaining km after last segment
    tail_km = dist_km - prev_end_km
    if tail_km > 0.5:
        tail_min = max(5, round(tail_km / _DESCENT_SPEED_KMH * 60))
        intervals.append({
            "type": "rest",
            "duration_minutes": tail_min,
            "notes": f"Final {tail_km:.1f} km — free ride home. Spin out, let HR drop.",
        })

    longer_note = ""
    if estimated_total > duration_minutes + 15:
        longer_note = (
            f" Note: full route is ~{estimated_total} min vs your {duration_minutes}-min plan — "
            "the extra time is free riding outside the structured block."
        )
    cooldown_notes = "Done — free ride / Z2 until you finish the route." + longer_note

    session = _make_session(warmup_min, warmup_notes, intervals, 0, cooldown_notes, route)
    session["total_duration_minutes"] = estimated_total
    session["route_summary"] = {
        "distance_km": round(dist_km, 1),
        "elevation_gain_m": round(gain_m),
        "estimated_minutes": estimated_total,
        "full_route_km": None,
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

    if dist_km:
        notes = (
            f"Ride the full {dist_km:.0f} km route at Z2 (est. {estimated_total} min). "
            "Stay conversational on every climb — back off power to stay in Z2. "
            "Eat every 30–45 min."
        )
    else:
        notes = (
            f"Steady Zone 2 {label}. Fully conversational throughout. "
            "Eat every 30–45 min. This session builds the aerobic engine."
        )

    intervals = [{"type": "work", "rep": 1, "total_reps": 1,
                  "duration_minutes": estimated_total - warmup - cooldown,
                  "target": "Z2 — fully conversational throughout",
                  "notes": notes, "segment": None}]

    session = _make_session(warmup, "Start easy — settle into aerobic pace over the first 10 min.",
                            intervals, cooldown, "Easy final km to flush legs.", route)
    session["total_duration_minutes"] = estimated_total
    if dist_km:
        session["route_summary"] = {
            "distance_km": round(dist_km, 1),
            "elevation_gain_m": round(gain_m),
            "estimated_minutes": estimated_total,
            "full_route_km": None,
        }
    return session


def _build_easy(duration_minutes: int, sport: str, route: "Route | None") -> dict:
    label = {"CYCLING": "ride", "RUNNING": "run", "XC_SKIING": "ski"}.get(sport, "session")
    analysis = route.analysis if route and route.analysis else {}
    dist_km = analysis.get("total_distance_m", 0) / 1000
    gain_m = analysis.get("total_gain_m", 0)
    estimated_total = _estimate_route_time_min(dist_km, gain_m) if dist_km else duration_minutes

    if dist_km:
        notes = (
            f"Easy {label} of the full {dist_km:.0f} km route (est. {estimated_total} min). "
            "Z1–Z2 throughout — back off on every climb to stay aerobic."
        )
    else:
        notes = (
            f"Easy {label}. Heart rate well below threshold — no laboured breathing. "
            "Don't let enthusiasm push you into Z3."
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
        session["route_summary"] = {
            "distance_km": round(dist_km, 1),
            "elevation_gain_m": round(gain_m),
            "estimated_minutes": estimated_total,
            "full_route_km": None,
        }
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

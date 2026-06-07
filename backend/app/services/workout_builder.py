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

from dataclasses import dataclass
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


def _route_analysis(route: "Route | None") -> tuple[float, float]:
    """Return (dist_km, gain_m) from route analysis, or (0, 0) if no route."""
    a = route.analysis if route and route.analysis else {}
    return a.get("total_distance_m", 0) / 1000, a.get("total_gain_m", 0)


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
    Estimate cycling time at Z2 endurance pace:
      flat time  = distance / 28 km/h
      climb time = elevation / 750 m/hr VAM (additional time lost to gravity)
    """
    return max(30, round(dist_km / 28 * 60 + gain_m / 750 * 60))


def _merge_consecutive_rests(intervals: list[dict]) -> list[dict]:
    """Collapse adjacent REST steps into a single step."""
    merged: list[dict] = []
    for step in intervals:
        if merged and step["type"] == "rest" and merged[-1]["type"] == "rest":
            prev = merged[-1]
            prev["duration_minutes"] += step["duration_minutes"]
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


def _route_summary(dist_km: float, gain_m: float, estimated_minutes: int) -> dict:
    return {
        "distance_km": round(dist_km, 1),
        "elevation_gain_m": round(gain_m),
        "estimated_minutes": estimated_minutes,
        "full_route_km": None,
    }


# ─── Route-ride builder ───────────────────────────────────────────────────────

_MAX_REST_BETWEEN_EFFORTS: dict[str, float] = {
    "VO2MAX": 8.0,
    "THRESHOLD": 12.0,
    "TEMPO": 20.0,
}
_DESCENT_SPEED_KMH = 32.0


@dataclass
class _WorkoutConfig:
    primary_cats: frozenset
    secondary_cats: frozenset
    primary_target: str
    primary_label: str
    secondary_target: str
    secondary_label: str
    rank_fn: object  # callable(seg) -> sort key


def _workout_config(workout_type: str, ftp: float | None) -> _WorkoutConfig:
    if workout_type == "VO2MAX":
        return _WorkoutConfig(
            primary_cats=frozenset({"SHORT_PUNCH", "MEDIUM_CLIMB"}),
            secondary_cats=frozenset({"LONG_CLIMB"}),
            primary_target=_ftp_target(110, 120, ftp),
            primary_label="VO2max — breathe hard, hold form",
            secondary_target=_ftp_target(80, 87, ftp),
            secondary_label="Long climb — stay Z2/Z3, save the legs",
            rank_fn=lambda s: abs(s["est_duration_at_ftp_min"] - 6),
        )
    if workout_type == "THRESHOLD":
        return _WorkoutConfig(
            primary_cats=frozenset({"LONG_CLIMB", "MEDIUM_CLIMB"}),
            secondary_cats=frozenset({"SHORT_PUNCH"}),
            primary_target=_ftp_target(95, 105, ftp),
            primary_label="Threshold — comfortably hard, steady power",
            secondary_target=_ftp_target(80, 88, ftp),
            secondary_label="Short punch — controlled, don't blow up",
            rank_fn=lambda s: -s["est_duration_at_ftp_min"],
        )
    # TEMPO
    return _WorkoutConfig(
        primary_cats=frozenset({"LONG_CLIMB", "MEDIUM_CLIMB", "SHORT_PUNCH"}),
        secondary_cats=frozenset(),
        primary_target=_ftp_target(88, 93, ftp),
        primary_label="Steady tempo — not easy, not a struggle",
        secondary_target=_ftp_target(88, 93, ftp),
        secondary_label="Steady tempo — not easy, not a struggle",
        rank_fn=lambda s: s.get("start_km", 0),
    )


def _segment_target(seg: dict, cfg: "_WorkoutConfig", ftp: float | None) -> str:
    perf_power = seg.get("avg_power_w")
    if perf_power and ftp:
        return f"{round(perf_power * 0.97)}–{round(perf_power * 1.03)} W (based on your last effort here)"
    return cfg.primary_target


def _gap_minutes(end_km: float, start_km: float) -> float:
    return max(0.0, (start_km - end_km) / _DESCENT_SPEED_KMH * 60)


def _effective_rest_minutes(seg_a: dict, seg_b: dict, all_segments: list[dict]) -> float:
    """Elapsed time from end of seg_a to start of seg_b, including intermediate terrain."""
    between = sorted(
        [s for s in all_segments
         if s["start_km"] >= seg_a["end_km"] - 0.01
         and s["end_km"] <= seg_b["start_km"] + 0.01
         and s is not seg_a and s is not seg_b],
        key=lambda s: s["start_km"],
    )
    total, prev_km = 0.0, seg_a["end_km"]
    for s in between:
        total += _gap_minutes(prev_km, s["start_km"])
        total += s["est_duration_at_ftp_min"]
        prev_km = s["end_km"]
    return total + _gap_minutes(prev_km, seg_b["start_km"])


def _find_best_cluster(
    primary_candidates: list[dict],
    all_segments: list[dict],
    hard_budget_min: float,
    max_rest_min: float,
    rank_fn,
) -> list[dict]:
    """
    Find the best cluster of consecutive primary segments where the effective
    rest between any two adjacent efforts never exceeds max_rest_min.

    1. Sort by position; split into clusters on effective-rest violations.
    2. For each cluster pick top-ranked segments within the hard budget.
    3. Re-validate in route order (ranking may reorder segments within a cluster).
    4. Return the cluster with the most total hard-effort time.
    """
    if not primary_candidates:
        return []

    by_pos = sorted(primary_candidates, key=lambda s: s["start_km"])
    clusters: list[list[dict]] = [[by_pos[0]]]
    for seg in by_pos[1:]:
        if _effective_rest_minutes(clusters[-1][-1], seg, all_segments) <= max_rest_min:
            clusters[-1].append(seg)
        else:
            clusters.append([seg])

    best: list[dict] = []
    best_work = 0.0

    for cluster in clusters:
        selected, work = [], 0.0
        for seg in sorted(cluster, key=rank_fn):
            t = seg["est_duration_at_ftp_min"]
            if work + t <= hard_budget_min:
                selected.append(seg)
                work += t

        # Re-validate in route order after ranking may have reordered
        in_order = sorted(selected, key=lambda s: s["start_km"])
        valid = [in_order[0]] if in_order else []
        for seg in in_order[1:]:
            if _effective_rest_minutes(valid[-1], seg, all_segments) <= max_rest_min:
                valid.append(seg)

        valid_work = sum(s["est_duration_at_ftp_min"] for s in valid)
        if valid_work > best_work:
            best_work, best = valid_work, valid

    return best


def _build_route_ride(
    workout_type: str,
    duration_minutes: int,
    sport: str,
    ftp: float | None,
    lthr: float | None,
    route: "Route",
) -> dict:
    """
    Always completes the full route. Structured efforts are carved into the best
    cluster of climbs; everything else is free riding at Z2.
    """
    analysis = route.analysis or {}
    dist_km = analysis.get("total_distance_m", 0) / 1000
    gain_m = analysis.get("total_gain_m", 0)
    all_segments = sorted(analysis.get("segments", []), key=lambda s: s.get("start_km", 0))

    # Merge performance profile data into segments if available
    perf_segs = (route.performance_profile or {}).get("segments_with_perf", [])
    if perf_segs:
        perf_by_pos = {(s.get("start_km"), s.get("end_km")): s for s in perf_segs}
        all_segments = [
            {**s, **{k: v for k, v in perf_by_pos.get((s.get("start_km"), s.get("end_km")), {}).items()
                     if k in ("avg_power_w", "avg_hr_bpm", "avg_speed_kmh")}}
            for s in all_segments
        ]

    # Commute zone limits — sections outside these km are off-limits for structured effort
    start_km_limit = getattr(route, "start_km", None)
    end_km_limit = getattr(route, "end_km", None)

    # Only consider segments within the active training zone
    active_segments = [
        s for s in all_segments
        if (start_km_limit is None or s["end_km"] > start_km_limit)
        and (end_km_limit is None or s["start_km"] < end_km_limit)
    ]

    estimated_total = _estimate_route_time_min(dist_km, gain_m)

    cfg = _workout_config(workout_type, ftp)
    max_rest_min = _MAX_REST_BETWEEN_EFFORTS.get(workout_type, 12.0)

    primary_candidates = [s for s in active_segments if s["category"] in cfg.primary_cats]
    selected = _find_best_cluster(
        primary_candidates, active_segments,
        hard_budget_min=duration_minutes * 0.60,
        max_rest_min=max_rest_min,
        rank_fn=cfg.rank_fn,
    )
    selected_ids = {id(s) for s in selected}

    cluster_start = selected[0]["start_km"] if selected else None
    cluster_end   = selected[-1]["end_km"]   if selected else None

    # Precompute which secondary segments fall inside the cluster
    secondary_in_cluster_ids = {
        id(s) for s in active_segments
        if s["category"] in cfg.secondary_cats
        and cluster_start is not None
        and s["start_km"] >= cluster_start
        and s["end_km"] <= cluster_end + 0.1
    }

    # ── Warmup ────────────────────────────────────────────────────────────────
    # The warmup covers everything from the route start up to the training zone.
    # If there is a commute-in section, it is folded into warmup with a note
    # that no structured effort is possible there (traffic, lights, etc.).
    training_start_km = start_km_limit if start_km_limit is not None else (
        active_segments[0]["start_km"] if active_segments else dist_km * 0.1
    )
    warmup_min = max(8, round(training_start_km / 28 * 60))

    if start_km_limit is not None and start_km_limit > 0.5:
        commute_in_min = max(5, round(start_km_limit / 28 * 60))
        if cluster_start is not None and cluster_start > start_km_limit + 1.0:
            ride_in_min = max(3, round((cluster_start - start_km_limit) / _DESCENT_SPEED_KMH * 60))
            warmup_notes = (
                f"Km 0–{start_km_limit:.1f}: commute to training area (~{commute_in_min} min). "
                "Traffic/lights — spin easy, no structured effort. "
                f"From km {start_km_limit:.1f}: {ride_in_min} min Z2 ride-in to workout section (km {cluster_start:.1f})."
            )
        else:
            warmup_notes = (
                f"Km 0–{start_km_limit:.1f}: commute to training area (~{commute_in_min} min). "
                "Traffic/lights — spin easy, no structured effort possible here."
            )
    else:
        first_km = active_segments[0]["start_km"] if active_segments else dist_km * 0.1
        warmup_min = max(8, round(min(first_km, 10.0) / 28 * 60))
        if cluster_start is not None and cluster_start > first_km + 1.0:
            ride_in_min = max(5, round((cluster_start - first_km) / _DESCENT_SPEED_KMH * 60))
            warmup_notes = (
                f"First {first_km:.1f} km at Z2 to warm up. "
                f"Then free ride {ride_in_min} min to the workout section (km {cluster_start:.1f})."
            )
        else:
            warmup_notes = f"First {training_start_km:.1f} km at easy Z2 — settle in before the terrain starts."

    # ── Interval loop — only within the active training zone ─────────────────
    intervals: list[dict] = []
    prev_end_km = training_start_km
    hard_rep, hard_rep_count = 0, len(selected)

    for seg in active_segments:
        gap_km = seg["start_km"] - prev_end_km
        if gap_km > 0.5:
            gap_min = max(2, round(gap_km / _DESCENT_SPEED_KMH * 60))
            inside = (
                cluster_start is not None
                and prev_end_km >= cluster_start - 0.1
                and seg["start_km"] <= cluster_end + 0.1
            )
            note = (
                f"Recovery — {gap_min} min easy spin before next climb. Drink, breathe."
                if inside else
                f"Km {prev_end_km:.1f}→{seg['start_km']:.1f}: free ride / Z2. "
                "No structured effort here — enjoy the scenery."
            )
            intervals.append({"type": "rest", "duration_minutes": gap_min, "notes": note})

        dur = max(1, round(seg["est_duration_at_ftp_min"]))
        length_str = (
            f"{seg['length_meters'] / 1000:.1f} km"
            if seg["length_meters"] >= 1000
            else f"{seg['length_meters']} m"
        )
        base = f"Km {seg['start_km']:.1f}: {seg['category'].replace('_', ' ').title()} — {length_str} at {seg['avg_gradient_pct']}% avg."

        if id(seg) in selected_ids:
            hard_rep += 1
            step: dict = {
                "type": "work", "rep": hard_rep, "total_reps": hard_rep_count,
                "duration_minutes": dur,
                "target": _segment_target(seg, cfg, ftp),
                "notes": f"{base} {cfg.primary_label}.",
                "segment": seg,
            }
        elif id(seg) in secondary_in_cluster_ids:
            step = {
                "type": "rest", "duration_minutes": dur,
                "target": cfg.secondary_target,
                "notes": f"{base} {cfg.secondary_label}.",
                "segment": seg,
            }
        else:
            step = {
                "type": "rest", "duration_minutes": dur,
                "notes": f"{base} Free ride / Z2 — not part of the structured block.",
                "segment": seg,
            }
        intervals.append(step)
        prev_end_km = seg["end_km"]

    # Gap from last segment to end of training zone
    training_end_km = end_km_limit if end_km_limit is not None else dist_km
    tail_active_km = training_end_km - prev_end_km
    if tail_active_km > 0.5:
        tail_min = max(3, round(tail_active_km / _DESCENT_SPEED_KMH * 60))
        intervals.append({
            "type": "rest", "duration_minutes": tail_min,
            "notes": f"Km {prev_end_km:.1f}→{training_end_km:.1f}: free ride / Z2 to end of training zone.",
        })

    # ── Cooldown ──────────────────────────────────────────────────────────────
    # If there is a commute-out section, it becomes the cooldown.
    if end_km_limit is not None and dist_km - end_km_limit > 0.5:
        commute_out_km = dist_km - end_km_limit
        commute_out_min = max(5, round(commute_out_km / 28 * 60))
        cooldown_notes = (
            f"Km {end_km_limit:.1f}→{dist_km:.1f}: commute home (~{commute_out_min} min). "
            "Traffic/lights — spin easy, workout is done."
        )
        cooldown_min = commute_out_min
    else:
        cooldown_min = 0
        extra = (
            f" Note: full route is ~{estimated_total} min vs your {duration_minutes}-min plan — "
            "the extra time is free riding outside the structured block."
            if estimated_total > duration_minutes + 15 else ""
        )
        cooldown_notes = "Done — free ride / Z2 until you finish the route." + extra
    session = _make_session(
        warmup_min, warmup_notes, intervals,
        cooldown_min, cooldown_notes,
        route,
    )
    session["total_duration_minutes"] = estimated_total
    session["route_summary"] = _route_summary(dist_km, gain_m, estimated_total)
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
    dist_km, gain_m = _route_analysis(route)
    estimated_total = _estimate_route_time_min(dist_km, gain_m) if dist_km else duration_minutes

    notes = (
        f"Ride the full {dist_km:.0f} km route at Z2 (est. {estimated_total} min). "
        "Stay conversational on every climb — back off power to stay in Z2. Eat every 30–45 min."
        if dist_km else
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
        session["route_summary"] = _route_summary(dist_km, gain_m, estimated_total)
    return session


def _build_easy(duration_minutes: int, sport: str, route: "Route | None") -> dict:
    label = {"CYCLING": "ride", "RUNNING": "run", "XC_SKIING": "ski"}.get(sport, "session")
    dist_km, gain_m = _route_analysis(route)
    estimated_total = _estimate_route_time_min(dist_km, gain_m) if dist_km else duration_minutes

    notes = (
        f"Easy {label} of the full {dist_km:.0f} km route (est. {estimated_total} min). "
        "Z1–Z2 throughout — back off on every climb to stay aerobic."
        if dist_km else
        f"Easy {label}. Heart rate well below threshold — no laboured breathing. "
        "Don't let enthusiasm push you into Z3."
    )
    intervals = [{"type": "work", "rep": 1, "total_reps": 1,
                  "duration_minutes": estimated_total,
                  "target": "Z1–Z2 — easy, fully conversational",
                  "notes": notes, "segment": None}]
    session = _make_session(0, None, intervals, 0, None, route)
    session["total_duration_minutes"] = estimated_total
    if dist_km:
        session["route_summary"] = _route_summary(dist_km, gain_m, estimated_total)
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
    return _make_session(0, None, intervals, 0, None, None)

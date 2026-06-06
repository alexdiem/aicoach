"""
Rule-based structured workout session builder.
Converts workout_type + duration + athlete thresholds into a warmup/interval/cooldown plan.
Route segments are used when available to give climb-specific instructions.
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
        return _build_easy(duration_minutes, sport)
    if workout_type == "LONG":
        return _build_long(duration_minutes, sport)
    if workout_type == "VO2MAX":
        return _build_vo2max(duration_minutes, sport, athlete_ftp, athlete_lthr, route)
    if workout_type == "THRESHOLD":
        return _build_threshold(duration_minutes, sport, athlete_ftp, athlete_lthr, route)
    if workout_type == "TEMPO":
        return _build_tempo(duration_minutes, sport, athlete_ftp, athlete_lthr, route)
    return _build_easy(duration_minutes, sport)


# ─── Helpers ──────────────────────────────────────────────────────────────────

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
        return f"{round(ftp * pct_lo / 100)}–{round(ftp * pct_hi / 100)} W  ({pct_lo}–{pct_hi}% FTP)"
    return f"{pct_lo}–{pct_hi}% FTP"


def _hr_target(pct_lo: int, pct_hi: int, lthr: float | None, zone: str) -> str:
    if lthr:
        return f"{round(lthr * pct_lo / 100)}–{round(lthr * pct_hi / 100)} bpm  ({zone})"
    return zone


def _route_segments(route: "Route | None", workout_type: str, target_min: float) -> list[dict]:
    if not route or not route.analysis:
        return []
    segs = route.analysis.get("segments", [])
    if not segs:
        return []
    if workout_type == "VO2MAX":
        candidates = [s for s in segs if s["category"] in ("SHORT_PUNCH", "MEDIUM_CLIMB")]
    elif workout_type == "THRESHOLD":
        candidates = [s for s in segs if s["category"] in ("LONG_CLIMB", "MEDIUM_CLIMB")] or segs
    else:
        candidates = segs
    candidates.sort(key=lambda s: abs(s["est_duration_at_ftp_min"] - target_min))
    return candidates[:4]


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


# ─── Builders ─────────────────────────────────────────────────────────────────

def _build_vo2max(duration_minutes, sport, ftp, lthr, route):
    warmup, cooldown = _warmup_cooldown(duration_minutes)
    available = duration_minutes - warmup - cooldown

    if sport == "CYCLING":
        interval_min = 6 if available < 35 else 8
        rest_min = 4
        target = _ftp_target(110, 120, ftp)
        warmup_notes = "Easy spin building cadence. Include 2–3 × 20s openers at high effort in the last 3 min to prime the system."
        work_notes_base = "Hard but controlled — breathe hard, hold form, don't sprint."
        rest_notes = "Easy spin. Full recovery before next rep — don't cut it short."
        cooldown_notes = "Easy spin, gradually reduce effort. Flush the legs."
    elif sport == "RUNNING":
        interval_min = 3
        rest_min = 3
        target = "5K race effort" if not lthr else f"≥{round(lthr * 0.97)} bpm"
        warmup_notes = "Easy jog building pace. Include 4 × 20s strides in the last 2 min."
        work_notes_base = "Hard but controlled — hold pace, don't sprint the first rep."
        rest_notes = "Easy jog or walk. Let HR drop below Z3 before next rep."
        cooldown_notes = "Easy jog, gradually slowing to a walk."
    else:  # XC_SKIING
        interval_min = 4
        rest_min = 3
        target = "Race effort / near-max HR"
        warmup_notes = "Easy skiing to loosen up. Include 2 short hard uphill efforts."
        work_notes_base = "Maximal uphill effort — technique can open up."
        rest_notes = "Easy glide on flat or descent. Recover fully."
        cooldown_notes = "Easy skiing to flush arms and legs."

    reps = max(3, min(8, available // (interval_min + rest_min)))
    segments = _route_segments(route, "VO2MAX", interval_min)

    intervals = []
    for i in range(reps):
        seg = segments[i % len(segments)] if segments else None
        notes = work_notes_base
        if seg:
            notes = (
                f"Up the {seg['category'].replace('_', ' ').lower()} "
                f"({seg['avg_gradient_pct']}% avg, ~{seg['est_duration_at_ftp_min']}min at FTP). "
                + work_notes_base
            )
        intervals.append({"type": "work", "rep": i + 1, "total_reps": reps,
                          "duration_minutes": interval_min, "target": target,
                          "notes": notes, "segment": seg})
        if i < reps - 1:
            intervals.append({"type": "rest", "duration_minutes": rest_min, "notes": rest_notes})

    return _make_session(warmup, warmup_notes, intervals, cooldown, cooldown_notes, route)


def _build_threshold(duration_minutes, sport, ftp, lthr, route):
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
        warmup_notes = "Easy spin building to Z3. Finish the last 3 min at tempo to prime the threshold system."
        work_notes_base = "Comfortably hard. You can speak in short sentences. Hold steady power — don't surge."
        rest_notes = "Easy spin. Let HR drop but keep moving."
        cooldown_notes = "Easy spin to gradually bring HR down."
    elif sport == "RUNNING":
        if available >= 40:
            interval_min, rest_min, reps = 20, 3, 2
        else:
            interval_min, rest_min, reps = max(15, available), 0, 1
        target = _hr_target(85, 92, lthr, "Z4 — comfortably hard")
        warmup_notes = "Easy jog building to threshold pace over the warmup."
        work_notes_base = "Threshold pace — a few words possible, not sentences."
        rest_notes = "Easy jog between reps."
        cooldown_notes = "Easy jog, gradually reducing pace."
    else:  # XC_SKIING
        interval_min = 15 if available >= 35 else 10
        rest_min = 5
        reps = max(1, available // (interval_min + rest_min))
        target = "85–92% max HR"
        warmup_notes = "Easy skiing building to threshold effort."
        work_notes_base = "Sustained hard effort — focus on technique as fatigue builds."
        rest_notes = "Easy glide."
        cooldown_notes = "Easy skiing."

    segments = _route_segments(route, "THRESHOLD", interval_min)

    intervals = []
    for i in range(reps):
        seg = segments[i % len(segments)] if segments else None
        notes = work_notes_base
        if seg:
            notes = (
                f"Sustained effort up {seg['category'].replace('_', ' ').lower()} "
                f"({seg['length_meters']}m at {seg['avg_gradient_pct']}% avg). "
                + work_notes_base
            )
        intervals.append({"type": "work", "rep": i + 1, "total_reps": reps,
                          "duration_minutes": interval_min, "target": target,
                          "notes": notes, "segment": seg})
        if i < reps - 1 and rest_min > 0:
            intervals.append({"type": "rest", "duration_minutes": rest_min, "notes": rest_notes})

    return _make_session(warmup, warmup_notes, intervals, cooldown, cooldown_notes, route)


def _build_tempo(duration_minutes, sport, ftp, lthr, route):
    warmup, cooldown = _warmup_cooldown(duration_minutes)
    available = duration_minutes - warmup - cooldown
    target = _ftp_target(88, 93, ftp) if sport == "CYCLING" else _hr_target(80, 87, lthr, "Z3")
    intervals = [{"type": "work", "rep": 1, "total_reps": 1, "duration_minutes": available,
                  "target": target, "notes": "Steady tempo — not easy, not a struggle. Hold even effort.",
                  "segment": None}]
    return _make_session(
        warmup, "Build to tempo pace over the warmup.",
        intervals,
        cooldown, "Easy effort to bring HR down.",
        route,
    )


def _build_long(duration_minutes, sport):
    warmup, cooldown = 10, 10
    label = {"CYCLING": "ride", "RUNNING": "run", "XC_SKIING": "ski session"}.get(sport, "session")
    intervals = [{"type": "work", "rep": 1, "total_reps": 1,
                  "duration_minutes": duration_minutes - warmup - cooldown,
                  "target": "Z2 — fully conversational throughout",
                  "notes": (
                      f"Steady Zone 2 {label}. If you can't speak in full sentences, back off. "
                      "Eat every 30–45 min. Resist drifting into Z3 on climbs — back off early."
                  ),
                  "segment": None}]
    return _make_session(
        warmup, "Start easy — settle into aerobic pace over the first 10 min.",
        intervals,
        cooldown, "Easy final segment to flush legs.",
        None,
    )


def _build_easy(duration_minutes, sport):
    label = {"CYCLING": "ride", "RUNNING": "run", "XC_SKIING": "ski"}.get(sport, "session")
    return {
        "warmup_minutes": 0, "warmup_notes": None,
        "intervals": [{"type": "work", "rep": 1, "total_reps": 1,
                       "duration_minutes": duration_minutes,
                       "target": "Z1–Z2 — easy, fully conversational",
                       "notes": (
                           f"Easy {label}. Heart rate well below threshold, no laboured breathing. "
                           "Don't let enthusiasm push you into Z3."
                       ),
                       "segment": None}],
        "cooldown_minutes": 0, "cooldown_notes": None,
        "route_id": None, "route_name": None,
        "total_duration_minutes": duration_minutes,
    }


def _build_strength(duration_minutes):
    available = duration_minutes - 10 - 8  # activation + mobility
    exercises = [
        ("Hip hinge",        "Deadlift or RDL — 4 × 6 @ 80–85% 1RM. Neutral spine, hamstring tension."),
        ("Squat pattern",    "Back squat or goblet squat — 4 × 8. Full depth, controlled descent."),
        ("Single-leg",       "Step-up or split squat — 3 × 10 each leg. Add load progressively."),
        ("Upper body pull",  "Row or pull-up — 3 × 10. Scapulae engaged throughout."),
        ("Core",             "Pallof press or dead bug — 3 × 12. Anti-rotation, slow and controlled."),
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
         "notes": "Hip flexor, pigeon, lat stretch, couch stretch — 60–90s each.",
         "segment": None},
    ]
    return {
        "warmup_minutes": 0, "warmup_notes": None,
        "intervals": intervals,
        "cooldown_minutes": 0, "cooldown_notes": None,
        "route_id": None, "route_name": None,
        "total_duration_minutes": duration_minutes,
    }

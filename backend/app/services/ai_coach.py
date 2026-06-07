"""
Claude Haiku integration for coaching narrative and compliance scoring.
Called sparingly — only where rule-based logic is genuinely insufficient.
Estimated cost: ~$0.01-0.05 per week of use.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import anthropic

from app.config import settings

if TYPE_CHECKING:
    from app.models.activity import Activity
    from app.models.athlete import Athlete
    from app.models.plan import PlannedWorkout, WeeklyPlan

SYSTEM_PROMPT = "You are a concise endurance sports coach. Be direct and practical. No fluff."

_VALID_MODELS = {"haiku": "claude-haiku-4-5-20251001", "sonnet": "claude-sonnet-4-6"}
DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def resolve_model(model_pref: str | None) -> str:
    """Map 'haiku'/'sonnet' shorthand to a full model ID."""
    if not model_pref:
        return DEFAULT_MODEL
    return _VALID_MODELS.get(model_pref.lower(), DEFAULT_MODEL)

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


async def generate_plan_narrative(
    athlete: "Athlete",
    plan_data: dict,
    fitness_context: dict,
    model_pref: str | None = None,
) -> str:
    """2-3 sentence coaching narrative for the weekly plan."""
    if not settings.ANTHROPIC_API_KEY:
        return _fallback_narrative(plan_data, fitness_context)

    ctl = fitness_context.get("ctl", 0)
    atl = fitness_context.get("atl", 0)
    tsb = fitness_context.get("tsb", 0)
    season = plan_data.get("season", "")
    phase = plan_data.get("phase", "")

    prompt = (
        f"Athlete: {athlete.display_name or 'Alex'}. "
        f"Season: {season}. Phase: {phase}. "
        f"Fitness (CTL): {ctl:.0f}. Fatigue (ATL): {atl:.0f}. Form (TSB): {tsb:.0f}. "
        f"Workouts: {', '.join(w['workout_type'] + ' ' + w['sport'] for w in plan_data.get('workouts', [])[:5])}. "
        "Write 2-3 sentences explaining this week's training focus and why. Be specific about the phase and metrics."
    )

    response = await _get_client().messages.create(
        model=resolve_model(model_pref),
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()


async def generate_train_now_narrative(
    athlete: "Athlete",
    sport: str,
    workout_type: str,
    duration_minutes: int,
    fitness_context: dict,
    model_pref: str | None = None,
) -> str:
    """1-2 sentence coaching intro for an on-demand session."""
    if not settings.ANTHROPIC_API_KEY:
        return f"A {workout_type.lower()} {sport.lower()} session chosen to match your current form."

    tsb = fitness_context.get("tsb", 0)
    ctl = fitness_context.get("ctl", 0)
    readiness_zone = fitness_context.get("readiness_zone", "")

    prompt = (
        f"Athlete: {athlete.display_name or 'Alex'}. "
        f"Fitness (CTL): {ctl:.0f}. Form (TSB): {tsb:.0f}. Readiness: {readiness_zone}. "
        f"Session: {workout_type} {sport} {duration_minutes}min. "
        "In 1-2 sentences, explain why this session type fits the athlete right now and what to focus on during it."
    )
    resp = await _get_client().messages.create(
        model=resolve_model(model_pref),
        max_tokens=120,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


async def score_workout_compliance(
    planned: "PlannedWorkout",
    actual: "Activity",
    athlete: "Athlete",
) -> dict:
    """
    Score how well an actual activity matched the planned workout.
    Rule-based scoring first; AI only for ambiguous outdoor rides.
    Returns {score: 0-100, rationale: str}.
    """
    # Rule-based: check if duration and TSS are in range
    planned_duration_s = planned.duration_minutes * 60
    actual_duration_s = actual.duration_seconds
    duration_pct = actual_duration_s / planned_duration_s if planned_duration_s > 0 else 1.0

    # Intensity check via HR zone (if available) or power
    hr_ok = True
    power_ok = True

    if actual.avg_heart_rate and athlete.lthr:
        hr_fraction = actual.avg_heart_rate / athlete.lthr
        expected_hr = _expected_hr_fraction(planned.workout_type)
        hr_ok = abs(hr_fraction - expected_hr) < 0.10

    if actual.normalized_power_watts and athlete.ftp_watts:
        if_ = actual.normalized_power_watts / athlete.ftp_watts
        expected_if = _expected_if(planned.workout_type)
        power_ok = abs(if_ - expected_if) < 0.08

    duration_score = min(1.0, duration_pct) if duration_pct <= 1.15 else max(0.5, 2.0 - duration_pct)
    intensity_score = (0.5 * int(hr_ok) + 0.5 * int(power_ok)) if (actual.avg_heart_rate or actual.normalized_power_watts) else 0.7

    rule_score = round((0.5 * duration_score + 0.5 * intensity_score) * 100)

    # Use AI only for ambiguous outdoor rides where physiological intent matters more than exact metrics
    use_ai = (
        settings.ANTHROPIC_API_KEY
        and not actual.is_indoor
        and planned.workout_type in ("VO2MAX", "THRESHOLD")
        and 40 < rule_score < 80
    )

    if use_ai:
        prompt = (
            f"Planned: {planned.workout_type} {planned.sport} {planned.duration_minutes}min. "
            f"Purpose: {planned.purpose[:100]}. "
            f"Actual: {actual.duration_seconds/60:.0f}min, "
            f"avg HR {actual.avg_heart_rate or 'N/A'}, "
            f"NP {actual.normalized_power_watts or 'N/A'}W, "
            f"TSS {actual.training_stress_score or 'N/A'}. "
            f"Athlete FTP: {athlete.ftp_watts}W, LTHR: {athlete.lthr}. "
            "Score compliance 0-100 based on whether the physiological intent was met (not exact numbers). "
            "Reply: SCORE: <number> | RATIONALE: <1 sentence>"
        )
        resp = await _get_client().messages.create(
            model=DEFAULT_MODEL,
            max_tokens=100,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        try:
            score_part, rationale_part = text.split("|")
            ai_score = int("".join(c for c in score_part if c.isdigit()))
            rationale = rationale_part.replace("RATIONALE:", "").strip()
            # Blend rule-based and AI scores
            final_score = round(0.4 * rule_score + 0.6 * ai_score)
            return {"score": final_score, "rationale": rationale}
        except Exception:
            pass  # fall through to rule-based

    rationale = _build_rationale(planned.workout_type, duration_pct, hr_ok, power_ok)
    return {"score": rule_score, "rationale": rationale}


async def suggest_workout_modification(
    workout_type: str,
    duration_minutes: int,
    terrain_rationale: str,
    athlete_ftp: float,
) -> str:
    """Short suggestion when no route fits a planned workout."""
    if not settings.ANTHROPIC_API_KEY:
        return f"No matching route found. Consider completing this {workout_type} session on the trainer."

    prompt = (
        f"Planned: {workout_type} {duration_minutes}min cycling, FTP {athlete_ftp:.0f}W. "
        f"Terrain situation: {terrain_rationale[:150]}. "
        "Suggest in 1-2 sentences how to adapt this workout for available terrain or trainer."
    )
    resp = await _get_client().messages.create(
        model=DEFAULT_MODEL,
        max_tokens=120,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def _expected_hr_fraction(workout_type: str) -> float:
    return {"EASY": 0.72, "RECOVERY": 0.65, "TEMPO": 0.83, "THRESHOLD": 0.92,
            "VO2MAX": 0.97, "LONG": 0.74, "STRENGTH": 0.65}.get(workout_type, 0.80)


def _expected_if(workout_type: str) -> float:
    return {"EASY": 0.65, "RECOVERY": 0.55, "TEMPO": 0.80, "THRESHOLD": 0.95,
            "VO2MAX": 1.05, "LONG": 0.68, "STRENGTH": 0.60}.get(workout_type, 0.75)


def _build_rationale(workout_type: str, duration_pct: float, hr_ok: bool, power_ok: bool) -> str:
    parts = []
    if duration_pct < 0.85:
        parts.append("significantly shorter than planned")
    elif duration_pct > 1.15:
        parts.append("longer than planned (good endurance)")
    else:
        parts.append("duration on target")
    if not hr_ok:
        parts.append("heart rate off target zone")
    if not power_ok:
        parts.append("power off target zone")
    return "; ".join(parts) if parts else "All metrics within acceptable range."


def _fallback_narrative(plan_data: dict, fitness_context: dict) -> str:
    phase = plan_data.get("phase", "BASE")
    ctl = fitness_context.get("ctl", 0)
    tsb = fitness_context.get("tsb", 0)
    messages = {
        "BASE": f"This is a base-building week focused on aerobic volume. Your CTL is {ctl:.0f} — keep building the engine with consistent Zone 2 work.",
        "BUILD": f"Build phase: intensity ramps up this week. With CTL at {ctl:.0f} and form at {tsb:.0f}, you're ready for quality sessions.",
        "PEAK": f"Peak week — your highest-quality training of the block. CTL {ctl:.0f} reflects solid fitness. Execute the hard sessions, recover well between them.",
        "RECOVERY": f"Recovery week. CTL stays at {ctl:.0f} while fatigue drops. Protect this week — adaptations happen during recovery, not just training.",
    }
    return messages.get(phase, "Consistent training this week. Execute the plan and listen to your body.")

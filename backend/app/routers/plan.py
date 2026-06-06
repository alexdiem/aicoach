from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_athlete_or_404
from app.models.activity import Activity
from app.models.athlete import Athlete
from app.models.plan import PlannedWorkout, WeeklyPlan
from app.models.route import Route
from app.services import ai_coach
from app.services.fitness import calculate_ctl_atl_tsb, calculate_daily_loads
from app.services.plan_generator import generate_weekly_plan_data, VALID_SPORTS
from app.services.season_detector import detect_season

router = APIRouter(prefix="/plan", tags=["plan"])


class DayPreference(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6, description="0=Monday, 6=Sunday")
    is_rest: bool = False
    preferred_sport: str | None = Field(
        None,
        description="CYCLING, RUNNING, XC_SKIING, or STRENGTH. None means no preference.",
    )

    @field_validator("preferred_sport")
    @classmethod
    def validate_preferred_sport(cls, v: str | None) -> str | None:
        if v and v not in VALID_SPORTS:
            raise ValueError(f"preferred_sport must be one of {VALID_SPORTS}")
        return v


VALID_PHASES = {"BASE", "BUILD", "PEAK", "RECOVERY"}


class GeneratePlanRequest(BaseModel):
    athlete_schedule: list[DayPreference] = Field(
        default_factory=list,
        description="Per-day constraints. Omit days you have no preference for.",
    )
    fun_activities: list[dict] = Field(default_factory=list)
    phase_override: str | None = Field(
        None,
        description="Force a specific training phase: BASE, BUILD, PEAK, or RECOVERY. "
                    "If omitted the phase is auto-detected from CTL, TSB, and the 4-week block.",
    )

    @field_validator("phase_override")
    @classmethod
    def validate_phase_override(cls, v: str | None) -> str | None:
        if v and v not in VALID_PHASES:
            raise ValueError(f"phase_override must be one of {VALID_PHASES}")
        return v


@router.post("/generate")
async def generate_plan(
    body: GeneratePlanRequest = None,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    if body is None:
        body = GeneratePlanRequest()
    athlete_id = athlete.id

    cutoff = date.today() - timedelta(days=90)
    acts_result = await db.execute(
        select(Activity)
        .where(Activity.athlete_id == athlete_id, Activity.start_time >= cutoff)
        .order_by(Activity.start_time)
    )
    activities = list(acts_result.scalars().all())

    daily_loads = calculate_daily_loads(activities, athlete)
    fitness_series = calculate_ctl_atl_tsb(daily_loads)
    latest = fitness_series[-1] if fitness_series else {"ctl": 0, "atl": 0, "tsb": 0}
    ctl, atl, tsb = latest["ctl"], latest["atl"], latest["tsb"]

    season, confidence = detect_season(activities)

    routes_result = await db.execute(select(Route).where(Route.athlete_id == athlete_id))
    routes = list(routes_result.scalars().all())

    # Serialise schedule constraints for the generator
    schedule = [s.model_dump() for s in body.athlete_schedule]

    plan_data = generate_weekly_plan_data(
        athlete=athlete,
        ctl=ctl,
        atl=atl,
        tsb=tsb,
        season=season,
        recent_activities=activities,
        fun_activities_next_week=body.fun_activities,
        available_routes=routes,
        athlete_schedule=schedule,
        phase_override=body.phase_override,
    )

    narrative = await ai_coach.generate_plan_narrative(
        athlete=athlete,
        plan_data=plan_data,
        fitness_context={"ctl": ctl, "atl": atl, "tsb": tsb},
    )

    plan = WeeklyPlan(
        athlete_id=athlete_id,
        week_start=plan_data["week_start"],
        season=plan_data["season"],
        phase=plan_data["phase"],
        ctl_at_generation=plan_data["ctl_at_generation"],
        ai_narrative=narrative,
    )
    db.add(plan)
    await db.flush()

    for w in plan_data["workouts"]:
        workout = PlannedWorkout(plan_id=plan.id, **w)
        db.add(workout)

    await db.flush()

    return {
        "plan_id": plan.id,
        "week_start": plan.week_start.isoformat(),
        "season": plan.season,
        "phase": plan.phase,
        "narrative": narrative,
        "fitness": {"ctl": ctl, "atl": atl, "tsb": tsb},
        "season_confidence": round(confidence, 2),
        "workout_count": len(plan_data["workouts"]),
    }


@router.get("/current")
async def get_current_plan(athlete_id: int, db: AsyncSession = Depends(get_db)):
    monday = date.today() - timedelta(days=date.today().weekday())
    result = await db.execute(
        select(WeeklyPlan)
        .where(WeeklyPlan.athlete_id == athlete_id, WeeklyPlan.week_start == monday)
        .order_by(desc(WeeklyPlan.created_at))
    )
    plan = result.scalars().first()
    if not plan:
        return None
    return await _serialize_plan(plan, db)


@router.get("/history")
async def get_plan_history(
    athlete_id: int,
    limit: int = Query(default=8, le=52),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WeeklyPlan)
        .where(WeeklyPlan.athlete_id == athlete_id)
        .order_by(desc(WeeklyPlan.week_start))
        .limit(limit)
    )
    plans = result.scalars().all()
    return [
        {"id": p.id, "week_start": p.week_start.isoformat(), "season": p.season,
         "phase": p.phase, "ctl": p.ctl_at_generation}
        for p in plans
    ]


@router.put("/workouts/{workout_id}/complete")
async def mark_workout_complete(
    workout_id: int,
    activity_id: int | None = None,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found.")

    workout.is_completed = True
    workout.completed_activity_id = activity_id

    if activity_id:
        act_result = await db.execute(select(Activity).where(Activity.id == activity_id))
        actual = act_result.scalar_one_or_none()
        if actual:
            compliance = await ai_coach.score_workout_compliance(workout, actual, athlete)
            workout.compliance_score = compliance["score"]
            workout.ai_compliance_notes = compliance["rationale"]

    return {"workout_id": workout_id, "completed": True, "compliance_score": workout.compliance_score}


async def _serialize_plan(plan: WeeklyPlan, db: AsyncSession) -> dict:
    workouts_result = await db.execute(
        select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id)
    )
    workouts = workouts_result.scalars().all()

    return {
        "id": plan.id,
        "week_start": plan.week_start.isoformat(),
        "season": plan.season,
        "phase": plan.phase,
        "ctl_at_generation": plan.ctl_at_generation,
        "narrative": plan.ai_narrative,
        "workouts": [
            {
                "id": w.id,
                "day_of_week": w.day_of_week,
                "sport": w.sport,
                "workout_type": w.workout_type,
                "duration_minutes": w.duration_minutes,
                "intensity_zone": w.intensity_zone,
                "purpose": w.purpose,
                "terrain_notes": w.terrain_notes,
                "is_completed": w.is_completed,
                "compliance_score": w.compliance_score,
                "ai_compliance_notes": w.ai_compliance_notes,
            }
            for w in workouts
        ],
    }

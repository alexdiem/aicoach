from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_athlete_or_404, verify_api_key
from app.models.activity import Activity
from app.models.athlete import Athlete
from app.models.plan import PlannedWorkout, WeeklyPlan
from app.models.route import Route
from app.services import ai_coach
from app.services.fitness import get_fitness_snapshot
from app.services.fit_export import session_to_fit
from app.services.plan_generator import generate_weekly_plan_data, VALID_SPORTS
from app.services.season_detector import detect_season
from app.services.workout_builder import build_structured_session

router = APIRouter(prefix="/plan", tags=["plan"], dependencies=[Depends(verify_api_key)])


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


def _workout_type_for_tsb(tsb: float, readiness_score: int) -> str:
    """Pick an appropriate workout intensity based on current form and readiness."""
    if readiness_score >= 75 and tsb >= 5:
        return "THRESHOLD"
    if readiness_score >= 60 and tsb >= -5:
        return "TEMPO"
    if readiness_score >= 40:
        return "EASY"
    return "RECOVERY"


class TrainNowRequest(BaseModel):
    model_config = {"protected_namespaces": ()}

    sport: str = Field(..., description="CYCLING, RUNNING, or XC_SKIING")
    duration_minutes: int | None = Field(None, ge=10, le=360)
    distance_km: float | None = Field(None, ge=1, le=200)
    model_pref: str | None = Field(None, description="'haiku' or 'sonnet'")

    @field_validator("sport")
    @classmethod
    def validate_sport(cls, v: str) -> str:
        if v not in VALID_SPORTS:
            raise ValueError(f"sport must be one of {VALID_SPORTS}")
        return v


@router.post("/train-now")
async def train_now(
    body: TrainNowRequest,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    """Generate an on-demand structured session based on current fitness and readiness."""
    athlete_id = athlete.id

    snapshot = await get_fitness_snapshot(athlete_id, db, include_readiness=True)
    latest = {"ctl": snapshot["ctl"], "atl": snapshot["atl"], "tsb": snapshot["tsb"]}
    readiness = snapshot["readiness"]

    # Resolve duration
    if body.duration_minutes:
        duration_minutes = body.duration_minutes
    elif body.distance_km:
        # rough time estimate by sport
        speed = {"CYCLING": 28.0, "RUNNING": 10.0, "XC_SKIING": 12.0}.get(body.sport, 20.0)
        duration_minutes = max(15, round(body.distance_km / speed * 60))
    else:
        duration_minutes = 60

    workout_type = _workout_type_for_tsb(latest["tsb"], readiness["score"])

    session = build_structured_session(
        workout_type=workout_type,
        duration_minutes=duration_minutes,
        sport=body.sport,
        athlete_ftp=athlete.ftp_watts,
        athlete_lthr=athlete.lthr,
    )

    narrative = await ai_coach.generate_train_now_narrative(
        athlete=athlete,
        sport=body.sport,
        workout_type=workout_type,
        duration_minutes=duration_minutes,
        fitness_context={**latest, "readiness_zone": readiness["zone"]},
        model_pref=body.model_pref,
    )

    return {
        "workout_type": workout_type,
        "sport": body.sport,
        "duration_minutes": duration_minutes,
        "narrative": narrative,
        "readiness": readiness,
        "session": session,
    }


@router.post("/generate")
async def generate_plan(
    body: GeneratePlanRequest = None,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    if body is None:
        body = GeneratePlanRequest()
    athlete_id = athlete.id

    snapshot = await get_fitness_snapshot(athlete_id, db)
    ctl, atl, tsb = snapshot["ctl"], snapshot["atl"], snapshot["tsb"]
    activities = snapshot["_activities"]

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
        matched_route = None
        if w.get("suggested_route_id"):
            matched_route = next((r for r in routes if r.id == w["suggested_route_id"]), None)
        structured = build_structured_session(
            workout_type=w["workout_type"],
            duration_minutes=w["duration_minutes"],
            sport=w["sport"],
            athlete_ftp=athlete.ftp_watts,
            athlete_lthr=athlete.lthr,
            route=matched_route,
        )
        workout = PlannedWorkout(plan_id=plan.id, structured_session=structured, **w)
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


@router.post("/workouts/{workout_id}/structure")
async def build_workout_structure(
    workout_id: int,
    route_id: int | None = None,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    """Rebuild (or build for the first time) the structured session for a workout, optionally using a specific route."""
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found.")

    route = None
    if route_id:
        route_result = await db.execute(
            select(Route).where(Route.id == route_id, Route.athlete_id == athlete.id)
        )
        route = route_result.scalar_one_or_none()

    structured = build_structured_session(
        workout_type=workout.workout_type,
        duration_minutes=workout.duration_minutes,
        sport=workout.sport,
        athlete_ftp=athlete.ftp_watts,
        athlete_lthr=athlete.lthr,
        route=route,
    )
    workout.structured_session = structured
    if route_id:
        workout.suggested_route_id = route_id

    return structured


@router.patch("/workouts/{workout_id}/unstructured")
async def set_workout_unstructured(
    workout_id: int,
    is_unstructured: bool,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found.")
    workout.is_unstructured = is_unstructured
    return {"workout_id": workout_id, "is_unstructured": is_unstructured}


@router.get("/workouts/{workout_id}/fit")
async def download_workout_fit(
    workout_id: int,
    athlete: Athlete = Depends(get_athlete_or_404),
    db: AsyncSession = Depends(get_db),
):
    """Download a Garmin FIT workout file for the given planned workout."""
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found.")
    if not workout.structured_session:
        raise HTTPException(status_code=422, detail="Workout has no structured session.")

    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    day = day_names[workout.day_of_week] if workout.day_of_week is not None else "Day"
    name = f"{day} {workout.workout_type} {workout.sport}".replace("_", " ").title()[:15]

    fit_bytes = session_to_fit(
        session=workout.structured_session,
        workout_name=name,
        sport=workout.sport,
    )

    filename = f"workout_{workout_id}_{workout.sport.lower()}.fit"
    return Response(
        content=fit_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
                "is_unstructured": w.is_unstructured,
                "structured_session": w.structured_session,
                "compliance_score": w.compliance_score,
                "ai_compliance_notes": w.ai_compliance_notes,
            }
            for w in workouts
        ],
    }

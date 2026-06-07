from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.route import Route
from app.services.activity_file_parser import parse_activity_file
from app.services.terrain import analyze_gpx, analyze_points, compute_segment_performance

router = APIRouter(prefix="/routes", tags=["routes"])


@router.post("/upload")
async def upload_route(
    athlete_id: int = Form(...),
    name: str = Form(...),
    activity_file: UploadFile = File(..., description="FIT or GPX activity file (accept: .fit,.gpx)"),
    db: AsyncSession = Depends(get_db),
):
    """Upload a FIT or GPX activity file, analyze terrain, store route."""
    content = await activity_file.read()
    filename = activity_file.filename or ""

    # Determine source file type
    if filename.lower().endswith(".fit"):
        source_file_type = "fit"
    else:
        source_file_type = "gpx"

    try:
        parsed = parse_activity_file(content, filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Activity file parsing failed: {e}")

    points = parsed["points"]

    if len(points) < 2:
        raise HTTPException(status_code=400, detail="Insufficient GPS data in activity file.")

    try:
        analysis = analyze_points(points)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Terrain analysis failed: {e}")

    # Compute segment performance from actual data
    segments_with_perf = compute_segment_performance(points, analysis.get("segments", []))
    performance_profile = {"segments_with_perf": segments_with_perf}

    route = Route(
        athlete_id=athlete_id,
        name=name,
        gpx_data=None,
        total_distance_meters=analysis.get("total_distance_m", 0),
        total_elevation_gain_meters=analysis.get("total_gain_m", 0),
        analysis=analysis,
        source_file_type=source_file_type,
        performance_profile=performance_profile,
    )
    db.add(route)
    await db.flush()

    return _serialize_route(route)


@router.get("")
async def list_routes(athlete_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Route).where(Route.athlete_id == athlete_id))
    routes = result.scalars().all()
    return [_serialize_route(r) for r in routes]


@router.get("/{route_id}")
async def get_route(route_id: int, athlete_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Route).where(Route.id == route_id, Route.athlete_id == athlete_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found.")
    return _serialize_route(route, include_gpx=True)


@router.patch("/{route_id}/range")
async def set_route_range(
    route_id: int,
    start_km: float | None = None,
    end_km: float | None = None,
    athlete_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Set the active training km range (exclude commute sections)."""
    result = await db.execute(
        select(Route).where(Route.id == route_id, Route.athlete_id == athlete_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found.")
    route.start_km = start_km
    route.end_km = end_km
    return _serialize_route(route)


@router.delete("/{route_id}")
async def delete_route(route_id: int, athlete_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Route).where(Route.id == route_id, Route.athlete_id == athlete_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found.")
    await db.delete(route)
    return {"deleted": True}


def _serialize_route(r: Route, include_gpx: bool = False) -> dict:
    data = {
        "id": r.id,
        "name": r.name,
        "distance_km": round(r.total_distance_meters / 1000, 1),
        "elevation_gain_m": round(r.total_elevation_gain_meters),
        "terrain_type": r.analysis.get("terrain_type") if r.analysis else None,
        "gain_per_10km": r.analysis.get("gain_per_10km") if r.analysis else None,
        "segments": r.analysis.get("segments", []) if r.analysis else [],
        "created_at": r.created_at.isoformat(),
        "start_km": r.start_km,
        "end_km": r.end_km,
        "performance_profile": r.performance_profile,
        "source_file_type": r.source_file_type,
    }
    if include_gpx:
        data["gpx_data"] = r.gpx_data
    return data

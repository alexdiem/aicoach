from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.route import Route
from app.services.terrain import analyze_gpx

router = APIRouter(prefix="/routes", tags=["routes"])


@router.post("/upload")
async def upload_route(
    athlete_id: int = Form(...),
    name: str = Form(...),
    gpx_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a GPX file, analyze terrain, store route."""
    content = await gpx_file.read()
    gpx_text = content.decode("utf-8", errors="replace")

    try:
        analysis = analyze_gpx(gpx_text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"GPX parsing failed: {e}")

    route = Route(
        athlete_id=athlete_id,
        name=name,
        gpx_data=gpx_text,
        total_distance_meters=analysis.get("total_distance_m", 0),
        total_elevation_gain_meters=analysis.get("total_gain_m", 0),
        analysis=analysis,
    )
    db.add(route)
    await db.flush()

    return {
        "id": route.id,
        "name": route.name,
        "distance_km": round(route.total_distance_meters / 1000, 1),
        "elevation_gain_m": round(route.total_elevation_gain_meters),
        "terrain_type": analysis.get("terrain_type"),
        "segment_count": len(analysis.get("segments", [])),
    }


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
    }
    if include_gpx:
        data["gpx_data"] = r.gpx_data
    return data

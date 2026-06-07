from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import Base, engine
from app.models import wellness as _wellness_model  # noqa: F401 — ensures table is registered
from app.routers import activities, athlete, auth, garmin_webhook, plan, routes


_MIGRATIONS = [
    "ALTER TABLE planned_workouts ADD COLUMN is_unstructured BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE planned_workouts ADD COLUMN structured_session TEXT",
    "ALTER TABLE routes ADD COLUMN start_km REAL",
    "ALTER TABLE routes ADD COLUMN end_km REAL",
    "ALTER TABLE routes ADD COLUMN performance_profile TEXT",
    "ALTER TABLE routes ADD COLUMN source_file_type TEXT",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for sql in _MIGRATIONS:
            try:
                await conn.execute(text(sql))
            except Exception:
                pass  # column already exists
    yield


app = FastAPI(title="aicoach", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(activities.router)
app.include_router(athlete.router)
app.include_router(plan.router)
app.include_router(routes.router)
app.include_router(garmin_webhook.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}

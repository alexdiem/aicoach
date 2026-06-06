from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.athlete import Athlete


async def get_athlete_or_404(
    athlete_id: int,
    db: AsyncSession = Depends(get_db),
) -> Athlete:
    result = await db.execute(select(Athlete).where(Athlete.id == athlete_id))
    athlete = result.scalar_one_or_none()
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found.")
    return athlete

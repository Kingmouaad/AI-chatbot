from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app import queries
from app.chat import router as chat_router
from app.config import CORS_ORIGINS
from app.db import get_db
from app.schemas import MenuItemOut, OpeningHoursOut

app = FastAPI(title="cafeteriaai")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/menu", response_model=list[MenuItemOut])
def menu(day_of_week: int | None = Query(default=None, ge=0, le=6), db: Session = Depends(get_db)):
    day = day_of_week if day_of_week is not None else queries.today_day_of_week()
    return queries.get_menu_for_day(db, day)


@app.get("/hours", response_model=list[OpeningHoursOut])
def hours(db: Session = Depends(get_db)):
    return queries.get_all_hours(db)

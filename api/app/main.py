from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import queries
from app.chat import router as chat_router
from app.config import API_PREFIX, CORS_ORIGINS
from app.db import get_db
from app.schemas import MenuItemOut, OpeningHoursOut

app = FastAPI(title="cafeteriaai", docs_url=f"{API_PREFIX}/docs", openapi_url=f"{API_PREFIX}/openapi.json")
api = APIRouter()  # all endpoints hang off this so they can sit under API_PREFIX

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

api.include_router(chat_router)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # FastAPI's default 422 echoes each error's `input`. For a message holding a lone surrogate
    # that makes the *response* impossible to encode (a 500), and a huge message gets echoed back
    # in full. Say where and why it failed, never what was sent.
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


@api.get("/health")
def health():
    return {"status": "ok"}


@api.get("/menu", response_model=list[MenuItemOut])
def menu(day_of_week: int | None = Query(default=None, ge=0, le=6), db: Session = Depends(get_db)):
    day = day_of_week if day_of_week is not None else queries.today_day_of_week()
    return queries.get_menu_for_day(db, day)


@api.get("/hours", response_model=list[OpeningHoursOut])
def hours(db: Session = Depends(get_db)):
    return queries.get_all_hours(db)


app.include_router(api, prefix=API_PREFIX)

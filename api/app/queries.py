from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MenuItem, OpeningHours


def today_day_of_week() -> int:
    return date.today().weekday()  # Monday=0 .. Sunday=6, matches day_of_week columns


def get_menu_for_day(db: Session, day_of_week: int) -> list[MenuItem]:
    stmt = select(MenuItem).where(MenuItem.day_of_week == day_of_week).order_by(MenuItem.category)
    return list(db.scalars(stmt))


def get_all_hours(db: Session) -> list[OpeningHours]:
    stmt = select(OpeningHours).order_by(OpeningHours.day_of_week)
    return list(db.scalars(stmt))


def get_hours_for_day(db: Session, day_of_week: int) -> OpeningHours | None:
    stmt = select(OpeningHours).where(OpeningHours.day_of_week == day_of_week)
    return db.scalars(stmt).first()

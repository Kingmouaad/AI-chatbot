import csv
import pathlib
from datetime import datetime
from decimal import Decimal

import joblib
from sqlalchemy import delete

from app.db import SessionLocal
from app.models import FaqChunk, MenuItem, OpeningHours

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED_DIR = ROOT / "data" / "seed"
VECTORIZER_PATH = ROOT / "app" / "nlp" / "artifacts" / "retrieval.joblib"


def load_csv(name: str) -> list[dict]:
    with open(SEED_DIR / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def seed_menu(db) -> None:
    db.execute(delete(MenuItem))
    for row in load_csv("menu_seed.csv"):
        tags = [t for t in row["dietary_tags"].split(";") if t]
        db.add(
            MenuItem(
                name=row["name"],
                description=row["description"] or None,
                price=Decimal(row["price"]),
                category=row["category"],
                dietary_tags=tags,
                day_of_week=int(row["day_of_week"]),
            )
        )


def seed_hours(db) -> None:
    db.execute(delete(OpeningHours))
    for row in load_csv("hours_seed.csv"):
        db.add(
            OpeningHours(
                day_of_week=int(row["day_of_week"]),
                open_time=datetime.strptime(row["open_time"], "%H:%M").time(),
                close_time=datetime.strptime(row["close_time"], "%H:%M").time(),
                note=row["note"] or None,
            )
        )


def seed_faqs(db) -> None:
    vectorizer = joblib.load(VECTORIZER_PATH)
    db.execute(delete(FaqChunk))
    rows = load_csv("faq_seed.csv")
    questions = [row["question"] for row in rows]
    vectors = vectorizer.transform(questions).toarray()
    for row, vector in zip(rows, vectors):
        db.add(
            FaqChunk(
                question=row["question"],
                answer=row["answer"],
                category=row["category"] or None,
                embedding=vector.tolist(),
            )
        )


def main() -> None:
    db = SessionLocal()
    try:
        seed_menu(db)
        seed_hours(db)
        seed_faqs(db)
        db.commit()
        print("Seeded menu, hours, and FAQ (with embeddings) into the database.")
    finally:
        db.close()


if __name__ == "__main__":
    main()

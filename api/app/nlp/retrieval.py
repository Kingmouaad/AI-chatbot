import pathlib

import joblib
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import RETRIEVAL_DISTANCE_THRESHOLD
from app.models import FaqChunk

ARTIFACT_PATH = pathlib.Path(__file__).resolve().parent / "artifacts" / "retrieval.joblib"

_vectorizer = None


def _load():
    global _vectorizer
    if _vectorizer is None:
        _vectorizer = joblib.load(ARTIFACT_PATH)
    return _vectorizer


def embed(text: str) -> list[float]:
    vectorizer = _load()
    return vectorizer.transform([text]).toarray()[0].tolist()


def search(db: Session, text: str) -> tuple[FaqChunk | None, float]:
    """Returns (best-matching FaqChunk or None, cosine distance). None if nothing clears the threshold."""
    query_vec = embed(text)
    distance_expr = FaqChunk.embedding.cosine_distance(query_vec)
    stmt = select(FaqChunk, distance_expr.label("distance")).order_by(distance_expr).limit(1)

    row = db.execute(stmt).first()
    if row is None:
        return None, 1.0

    chunk, distance = row
    # "not <=" rather than ">": a query sharing no word with the FAQ vocabulary embeds to the zero
    # vector, whose cosine distance is NaN, and `NaN > threshold` is False -- which would let an
    # arbitrary FAQ answer through as if it were a confident match.
    if not distance <= RETRIEVAL_DISTANCE_THRESHOLD:
        return None, distance
    return chunk, distance

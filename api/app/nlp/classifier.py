import pathlib

import joblib

from app.config import CLASSIFIER_CONFIDENCE_THRESHOLD

ARTIFACT_PATH = pathlib.Path(__file__).resolve().parent / "artifacts" / "classifier.joblib"

_pipeline = None


def _load():
    global _pipeline
    if _pipeline is None:
        _pipeline = joblib.load(ARTIFACT_PATH)
    return _pipeline


def predict(text: str) -> tuple[str, float]:
    """Returns (intent, confidence). Low-confidence predictions are demoted to out_of_scope."""
    pipeline = _load()
    proba = pipeline.predict_proba([text])[0]
    idx = proba.argmax()
    intent = pipeline.classes_[idx]
    confidence = float(proba[idx])
    if confidence < CLASSIFIER_CONFIDENCE_THRESHOLD:
        return "out_of_scope", confidence
    return intent, confidence

from app.db import SessionLocal
from app.nlp import pipeline


def _run(db, text, expected_source, expected_intent=None):
    result = pipeline.handle(db, text)
    assert result.source == expected_source, (
        f"{text!r}: expected source={expected_source!r}, got {result.source!r} "
        f"(intent={result.intent!r}, reply={result.reply!r})"
    )
    if expected_intent is not None:
        assert result.intent == expected_intent, (
            f"{text!r}: expected intent={expected_intent!r}, got {result.intent!r}"
        )
    return result


def test_pipeline_smoke():
    # Requires the local DB to be migrated and seeded (docker compose up, alembic
    # upgrade head, train_retrieval + train_classifier + seed_db) -- this is an
    # integration smoke test, not a unit test with mocks.
    db = SessionLocal()
    try:
        _run(db, "hello", "rule", "greeting")
        _run(db, "what time do you close today", "rule", "hours_query")
        _run(db, "what's on the menu today", "rule", "menu_query")
        _run(db, "any veggie options today", "classifier", "menu_query")
        # "open"/"close"/"hours" trigger the rules layer directly -- this phrasing
        # avoids every rule keyword so it actually exercises the classifier path.
        _run(db, "when do you reopen after the break", "classifier", "hours_query")
        _run(db, "is the food halal", "retrieval", "faq")
        _run(db, "the food was amazing today", "classifier", "feedback")
        _run(db, "what's the capital of france", "fallback")
    finally:
        db.close()


if __name__ == "__main__":
    test_pipeline_smoke()
    print("All pipeline smoke tests passed.")

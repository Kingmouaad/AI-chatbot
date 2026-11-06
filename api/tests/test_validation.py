"""Input-validation regressions found by the independent API check. Pure logic, no database."""
import asyncio

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.main import validation_error
from app.nlp.rules import GREETING_RE
from app.schemas import ChatRequest, RatingRequest


@pytest.mark.parametrize("bad", ["a" * 1001, "hello\x00world", "hello \ud800 world"])
def test_chat_message_that_cannot_be_stored_is_rejected(bad):
    with pytest.raises(ValidationError):
        ChatRequest(message=bad)


@pytest.mark.parametrize("bad", ["hello \ud800 world", "x" * 5000])
def test_422_response_never_echoes_the_input(bad):
    # The default FastAPI handler echoes `input`; with a lone surrogate that made the 422 itself
    # un-encodable (a 500), and a huge message came straight back. Rendering must not raise.
    with pytest.raises(ValidationError) as caught:
        ChatRequest(message=bad)
    response = asyncio.run(validation_error(None, RequestValidationError(caught.value.errors())))
    assert response.status_code == 422
    assert len(response.body) < 400 and b'"input"' not in response.body


@pytest.mark.parametrize("ok", ["a" * 1000, "مرحبا 🍽️", "line one\nline two", ""])
def test_chat_message_boundary_and_unicode_are_accepted(ok):
    ChatRequest(message=ok)


@pytest.mark.parametrize("bad", [True, 1.0, 0, 2, "1", "good"])
def test_rating_is_strict(bad):
    with pytest.raises(ValidationError):
        RatingRequest(rating=bad)


@pytest.mark.parametrize("ok", [1, -1, None])
def test_rating_accepts_good_bad_or_clear(ok):
    assert RatingRequest(rating=ok).rating == ok


@pytest.mark.parametrize(
    "text, is_greeting",
    [
        ("hello", True),
        ("Hi there!", True),
        ("good morning", True),
        ("Hello, what's on the menu today?", False),
        ("Hi, can I pay by card?", False),
        ("hey what time do you close", False),
    ],
)
def test_greeting_rule_only_matches_a_bare_greeting(text, is_greeting):
    assert bool(GREETING_RE.search(text.lower().strip())) is is_greeting

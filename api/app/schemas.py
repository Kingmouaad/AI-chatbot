from datetime import time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MenuItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    price: Decimal
    category: str
    dietary_tags: list[str]
    day_of_week: int


class OpeningHoursOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    day_of_week: int
    open_time: time
    close_time: time
    note: str | None


class ChatRequest(BaseModel):
    # 1000 matches the chat_messages.user_message column; anything longer would only fail at
    # insert time as a 500 instead of a clean 422.
    message: str = Field(max_length=1000)

    @field_validator("message")
    @classmethod
    def no_nul(cls, value: str) -> str:
        # Postgres text cannot hold NUL; it would blow up at insert time as a 500.
        # (Lone surrogates are already rejected by pydantic itself.)
        if "\x00" in value:
            raise ValueError("message must not contain NUL characters")
        return value


class ChatResponse(BaseModel):
    reply: str
    suggestions: list[str]
    intent: str | None
    source: str
    message_id: int


class RatingRequest(BaseModel):
    rating: Literal[1, -1] | None  # +1 good, -1 bad, null clears an earlier rating

    @field_validator("rating", mode="before")
    @classmethod
    def real_int(cls, value):
        # Literal compares by equality, so `true` and `1.0` would otherwise slip through as 1
        # (strict mode doesn't change that).
        if value is not None and type(value) is not int:
            raise ValueError("rating must be 1, -1 or null")
        return value

from datetime import time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


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
    message: str


class ChatResponse(BaseModel):
    reply: str
    suggestions: list[str]
    intent: str | None
    source: str
    message_id: int


class RatingRequest(BaseModel):
    rating: Literal[1, -1] | None  # +1 good, -1 bad, null clears an earlier rating

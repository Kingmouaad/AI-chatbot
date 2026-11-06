from datetime import datetime, time
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import ARRAY, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.config import EMBEDDING_DIM
from app.db import Base


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(500))
    price: Mapped[Decimal]
    category: Mapped[str] = mapped_column(String(20))  # breakfast/lunch/dinner/snack
    dietary_tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    day_of_week: Mapped[int]  # 0=Monday .. 6=Sunday, recurring weekly


class OpeningHours(Base):
    __tablename__ = "opening_hours"
    __table_args__ = (UniqueConstraint("day_of_week"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    day_of_week: Mapped[int]
    open_time: Mapped[time]
    close_time: Mapped[time]
    note: Mapped[str | None] = mapped_column(String(200))


class FaqChunk(Base):
    __tablename__ = "faq_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(String(500))
    answer: Mapped[str] = mapped_column(String(1000))
    category: Mapped[str | None] = mapped_column(String(50))
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM))


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_message: Mapped[str] = mapped_column(String(1000))
    detected_intent: Mapped[str | None] = mapped_column(String(50))
    source: Mapped[str] = mapped_column(String(20))  # rule|classifier|retrieval|fallback
    bot_response: Mapped[str] = mapped_column(String(1000))
    matched_faq_id: Mapped[int | None] = mapped_column(ForeignKey("faq_chunks.id"))
    classifier_confidence: Mapped[float | None]
    retrieval_distance: Mapped[float | None]
    rating: Mapped[int | None]  # +1 / -1 / NULL, set later via a future feedback endpoint
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

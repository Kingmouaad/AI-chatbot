from dataclasses import dataclass

from sqlalchemy.orm import Session

from app import queries
from app.nlp import classifier, retrieval, rules

FALLBACK_REPLY = (
    "Sorry, I didn't quite get that. I can help with today's menu, our hours, "
    "or general cafeteria questions."
)
FEEDBACK_ACK = "Thanks for letting us know -- I've passed this along."
SUGGESTIONS = ["What's today's menu?", "What are your hours?", "I have some feedback"]


@dataclass
class ChatResult:
    reply: str
    intent: str | None
    source: str
    classifier_confidence: float | None = None
    retrieval_distance: float | None = None
    matched_faq_id: int | None = None


def _resolved_day(text: str) -> int:
    day = rules.resolve_day(text)
    return day if day is not None else queries.today_day_of_week()


def handle(db: Session, text: str) -> ChatResult:
    rule_hit = rules.match(text, db)
    if rule_hit is not None:
        return ChatResult(reply=rule_hit.reply, intent=rule_hit.intent, source="rule")

    intent, confidence = classifier.predict(text)

    if intent == "menu_query":
        day = _resolved_day(text)
        reply = rules.format_menu_reply(queries.get_menu_for_day(db, day), day)
        return ChatResult(reply, intent, "classifier", classifier_confidence=confidence)

    if intent == "hours_query":
        day = _resolved_day(text)
        reply = rules.format_hours_reply(queries.get_hours_for_day(db, day), day)
        return ChatResult(reply, intent, "classifier", classifier_confidence=confidence)

    if intent == "feedback":
        return ChatResult(FEEDBACK_ACK, intent, "classifier", classifier_confidence=confidence)

    if intent == "faq":
        chunk, distance = retrieval.search(db, text)
        if chunk is not None:
            return ChatResult(
                chunk.answer,
                intent,
                "retrieval",
                classifier_confidence=confidence,
                retrieval_distance=distance,
                matched_faq_id=chunk.id,
            )
        return ChatResult(
            FALLBACK_REPLY, intent, "fallback",
            classifier_confidence=confidence, retrieval_distance=distance,
        )

    # out_of_scope, including predictions classifier.predict() demoted for low confidence
    return ChatResult(FALLBACK_REPLY, intent, "fallback", classifier_confidence=confidence)

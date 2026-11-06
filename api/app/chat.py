from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ChatMessage
from app.nlp import pipeline
from app.schemas import ChatRequest, ChatResponse

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    result = pipeline.handle(db, request.message)

    message = ChatMessage(
        user_message=request.message,
        detected_intent=result.intent,
        source=result.source,
        bot_response=result.reply,
        matched_faq_id=result.matched_faq_id,
        classifier_confidence=result.classifier_confidence,
        retrieval_distance=result.retrieval_distance,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    return ChatResponse(
        reply=result.reply,
        suggestions=pipeline.SUGGESTIONS,
        intent=result.intent,
        source=result.source,
        message_id=message.id,
    )

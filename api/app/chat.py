from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ChatMessage
from app.nlp import pipeline
from app.schemas import ChatRequest, ChatResponse, RatingRequest

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


@router.put("/chat/{message_id}/rating", status_code=204)
def rate(
    # bounded to the int4 primary key: a larger id would be a database error (500), not a 404
    message_id: Annotated[int, Path(ge=1, le=2**31 - 1)],
    request: RatingRequest,
    db: Session = Depends(get_db),
):
    message = db.get(ChatMessage, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="message not found")
    message.rating = request.rating
    db.commit()

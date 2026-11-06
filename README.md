# cafeteriaai

A text chat assistant for a university campus cafeteria. English only for v1. Every answer is templated or retrieved — there is no LLM call anywhere in the reply path.

This doc explains what exists, why each piece is shaped the way it is, and shows the one function that does the real work at each stage.

## Architecture at a glance

A message hits three layers in order, each one only handling what the layer before it couldn't:

```
user message
    |
    v
 RULES         -- regex/keyword, direct DB lookup, no ML.      "what time do you close today"
    | (no match)
    v
 CLASSIFIER    -- "base model": which of 5 intents is this?    "when do you reopen after the break"
    | (routes by intent)
    v
 RETRIEVAL     -- only for the `faq` intent: vector search      "is the food halal"
    | over a small FAQ table
    v
 reply + logged to chat_messages
```

Why cascade instead of one model doing everything: the obvious, high-frequency phrasings ("what time do you open") are cheaper and more reliable to catch with a regex than to spend a trained model's capacity on. That keeps the classifier's job smaller (only the phrasings rules miss) and keeps its training set cleaner. Retrieval only gets invoked for the one intent (`faq`) that's actually open-ended — menu and hours questions are always answered from structured data, never from the FAQ text, because asking "what's for lunch" should never risk returning a generic retrieved paragraph instead of today's actual menu row.

## The data model

Four tables, chosen to match exactly what the pipeline needs to read or write — no speculative columns.

- **`menu_items`** — `name, description, price, category, dietary_tags, day_of_week`.
  `day_of_week` (0=Monday..6=Sunday) instead of a literal calendar date, on purpose: a literal date means the seed data silently runs out after a week or two, and a chat bot that stops answering "what's for lunch" a month into a course project is a bad look. A weekly rotation never goes stale.
- **`opening_hours`** — `day_of_week` (unique), `open_time`, `close_time`, `note`. Same recurring pattern, one row per weekday.
- **`faq_chunks`** — `question, answer, category, embedding`. The thing retrieval searches over. `embedding` is a `pgvector` column sized to whatever the real FAQ vocabulary turns out to be (see Retrieval below) — not a round number picked in advance.
- **`chat_messages`** — every exchange, logged: `user_message, detected_intent, source, bot_response, matched_faq_id, classifier_confidence, retrieval_distance, rating, created_at`. This is both the audit trail and the raw material for the evaluation write-up — `source` and the two separate confidence/distance columns let you pull concrete examples like "asked X, classifier was 92% confident it's menu_query, answered from the DB" straight out of the table instead of describing the system only in the abstract. `classifier_confidence` (higher = more sure) and `retrieval_distance` (lower = more similar) are kept as two separate nullable columns rather than one generic "confidence" field, because they point in opposite directions — collapsing them invites a sign-confusion bug later.

## The pipeline, stage by stage

### 1. Rules — the fast, deterministic path

**Purpose:** catch the phrasings that are so common and unambiguous that running them through a trained model would be pure overhead. **Logic:** a handful of regexes for greeting / hours / menu, checked in order; the first match wins and goes straight to a DB lookup — no model is involved at all.

```python
def match(text: str, db) -> RuleResult | None:
    normalized = text.lower().strip()

    # Ramadan + hours is deliberately NOT handled here -- it falls through to
    # classifier -> retrieval, which answers from a static FAQ entry instead
    # of a holiday-override table that doesn't otherwise need to exist.
    if RAMADAN_RE.search(normalized) and HOURS_RE.search(normalized):
        return None

    if GREETING_RE.search(normalized):
        return RuleResult("Hi! Ask me about today's menu, our hours, ...", intent="greeting")

    if HOURS_RE.search(normalized):
        day = resolve_day(normalized) or date.today().weekday()
        return RuleResult(format_hours_reply(queries.get_hours_for_day(db, day), day), intent="hours_query")

    if MENU_RE.search(normalized):
        day = resolve_day(normalized) or date.today().weekday()
        return RuleResult(format_menu_reply(queries.get_menu_for_day(db, day), day), intent="menu_query")

    return None  # nothing matched -- fall through to the classifier
```

One real bug this layer had and no longer has: the menu regex originally included the words "food" and "eat", which also show up in FAQ questions ("is the **food** halal") that have nothing to do with today's menu — those got hijacked into a menu dump instead of reaching retrieval. Fixed by dropping the two generic words and keeping only actual meal-time words (`menu|lunch|breakfast|dinner|serving|served`).

### 2. Classifier — the "base model"

**Purpose:** everything rules didn't catch still needs to be routed somewhere. **Logic:** TF-IDF turns the message into a bag-of-words vector, Logistic Regression scores it against 5 intents (`menu_query`, `hours_query`, `faq`, `feedback`, `out_of_scope`), and the top-scoring intent wins — unless its own confidence is too low, in which case it's treated as out-of-scope rather than trusted. Logistic Regression specifically (over something like a linear SVM) because it gives genuine probabilities (`predict_proba`) out of the box, which the confidence check needs.

```python
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
```

The confidence threshold isn't a guess sitting in the code — it's tuned against data. Cross-validated out-of-fold predictions on the training set showed correct predictions have a *median* confidence of ~0.40 and wrong ones ~0.29: the two distributions overlap heavily at this data size (126 examples across 5 classes), so there's no value that cleanly separates them. The threshold (`0.3`, in `config.py`) sits near the 10th percentile of *correct* predictions — it keeps most genuinely correct calls through while still filtering the least-confident guesses. This is also exactly why the evaluation step has to look at the real score distribution instead of freezing a round number upfront: a 0.4 threshold (the first guess) was silently discarding about half of all correct predictions.

### 3. Retrieval — vector search over the FAQ table

**Purpose:** answer the open-ended questions that aren't about today's specific menu or hours (payment methods, lost cards, dietary policy, Ramadan hours, ...) without writing a hardcoded answer for every possible phrasing. **Logic:** the same idea as TF-IDF above, applied to similarity instead of classification — embed the query, find the closest stored FAQ question by cosine distance, return its answer verbatim if the distance clears a threshold, otherwise fall back.

```python
def search(db: Session, text: str) -> tuple[FaqChunk | None, float]:
    """Returns (best-matching FaqChunk or None, cosine distance). None if nothing clears the threshold."""
    query_vec = embed(text)
    distance_expr = FaqChunk.embedding.cosine_distance(query_vec)
    stmt = select(FaqChunk, distance_expr.label("distance")).order_by(distance_expr).limit(1)

    row = db.execute(stmt).first()
    if row is None:
        return None, 1.0

    chunk, distance = row
    if distance > RETRIEVAL_DISTANCE_THRESHOLD:
        return None, distance
    return chunk, distance
```

Why plain TF-IDF and not a real sentence-embedding model (e.g. sentence-transformers): with only ~15-20 FAQ entries, there's no corpus large enough for a heavier model to meaningfully out-perform TF-IDF on, and `torch`/`transformers` would eat a large chunk of Render's free-tier 512MB RAM for that marginal gain. TF-IDF also skipped an extra dimensionality-reduction step (TruncatedSVD) that was in an earlier draft of this plan — same reasoning, not enough data for it to learn anything useful, and it was one more trained artifact to maintain for no measurable benefit. The embedding dimension itself (currently 61) isn't a round number either — it's the real vocabulary size measured by fitting the vectorizer on the actual FAQ questions, because guessing a dimension and hoping the real vocabulary matches it is exactly the kind of mismatch that silently breaks or silently degrades a retrieval system.

### 4. Orchestration — tying the three layers together

**Purpose:** one place that knows the full cascade, so the FastAPI route itself stays a thin wrapper and the whole pipeline is callable (and testable) without spinning up a web server.

```python
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
        ...  # same shape as menu_query

    if intent == "feedback":
        return ChatResult(FEEDBACK_ACK, intent, "classifier", classifier_confidence=confidence)

    if intent == "faq":
        chunk, distance = retrieval.search(db, text)
        if chunk is not None:
            return ChatResult(chunk.answer, intent, "retrieval",
                               classifier_confidence=confidence, retrieval_distance=distance,
                               matched_faq_id=chunk.id)
        return ChatResult(FALLBACK_REPLY, intent, "fallback", ...)

    return ChatResult(FALLBACK_REPLY, intent, "fallback", classifier_confidence=confidence)
```

Notice `menu_query`/`hours_query` call the *exact same* `rules.format_menu_reply` / `format_hours_reply` functions that the rules layer itself uses — whether a menu question got caught by a keyword regex or by the classifier, the answer is built identically from the same DB query. That's deliberate: the classifier's job is only ever to *route*, never to answer differently than rules would have.

Every call, regardless of which layer answered, gets logged by `app/chat.py` into `chat_messages` with its `source`, `detected_intent`, and whichever confidence/distance number applies — that log is what the confusion matrix and the report's worked examples are pulled from.

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /health` | Render health check / pre-warm before a demo |
| `GET /menu?day_of_week=` | Today's menu by default, or any weekday |
| `GET /hours` | The full weekly schedule |
| `POST /chat {"message": "..."}` | Runs the pipeline above; returns `{reply, suggestions[], intent, source, message_id}` |

## Evaluation

The classifier is evaluated with **5-fold stratified cross-validation** (`sklearn.model_selection.cross_val_predict`), not a single train/test split — with only ~126 labeled examples, one split would leave the confusion matrix built from ~25 held-out points, too thin to mean much. Cross-validation gets an out-of-fold prediction for *every* labeled example (so nothing is ever scored by a model that trained on it) before the confusion matrix and classification report are built. The model that actually ships (`classifier.joblib`) is then fit once more on *all* the labeled data — cross-validation is only for the honest evaluation number, not for the deployed artifact. Artifacts land in `api/app/nlp/artifacts/`: `confusion_matrix.png`, `classification_report.txt`.

Retrieval doesn't get a second confusion matrix (the course wants one, clearly aimed at the classifier) — it's meant to be evaluated separately with hit-rate@1 over hand-written *paraphrases* of the stored FAQ questions (never the literal stored text, which would trivially score a perfect match and prove nothing). That evaluation set hasn't been written yet — see Limitations.

## Known limitations / deliberately out of scope

- **English only.** No Arabic/French support yet — a real decision, not an oversight, to ship something working before tackling code-switching.
- **No generative model anywhere.** Every reply is either a template filled from the DB or a retrieved FAQ answer verbatim. More natural-sounding, LLM-generated replies were considered and explicitly rejected for v1 (cost, latency, hallucination risk, and harder to evaluate).
- **Placeholder content.** `menu_seed.csv`, `hours_seed.csv`, `faq_seed.csv`, and `intents_train.csv` are all realistic-but-invented placeholders, not a real cafeteria's actual data. The training examples in particular are worth reviewing/extending with real phrasing before leaning on the confusion matrix too heavily in the report.
- **Retrieval's own evaluation set (paraphrased queries, hit-rate@1) hasn't been written yet** — only the classifier has a finished evaluation pipeline so far.
- **Single cafeteria, no accounts.** Anonymous chat, one location — both cheap assumptions to change later if they turn out to be wrong, not load-bearing design decisions.
- **Next.js UI and Render deployment are separate, later rounds** — this covers the backend only.

## Local setup

```bash
cd api
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
cp ../.env.example ../.env   # then edit DATABASE_URL if needed

docker compose -f ../docker-compose.yml up -d     # local Postgres w/ pgvector
.venv/Scripts/python.exe -m alembic upgrade head

# -m, not a bare path -- these import the app package, which needs api/ on sys.path
.venv/Scripts/python.exe -m scripts.train_retrieval    # fits FAQ embeddings -> artifacts/retrieval.joblib
.venv/Scripts/python.exe -m scripts.train_classifier   # trains intent classifier -> artifacts/classifier.joblib + confusion_matrix.png
.venv/Scripts/python.exe -m scripts.seed_db            # loads menu/hours/faqs (with embeddings) into DB

.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

(Commands above work as-is in Git Bash/WSL. In PowerShell, use `.venv\Scripts\python.exe` instead.)

Then: `GET /health`, `GET /menu`, `GET /hours`, `POST /chat {"message": "..."}`. Run the smoke test with `.venv/Scripts/python.exe -m pytest tests/test_pipeline.py`.

## Production

Same `DATABASE_URL` env var, pointed at a Neon connection string instead of local Docker Postgres. Use Neon's direct/unpooled connection string, not the `-pooler` one — nothing about this project's traffic needs connection pooling yet, and pooled connections are known to break prepared statements mid-seed. Neon needs the `vector` extension enabled, which the initial Alembic migration already does with `CREATE EXTENSION IF NOT EXISTS vector`.

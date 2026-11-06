# cafeteriaai

A text chat assistant for a university campus cafeteria: ask about today's menu, the opening hours, or general cafeteria questions (payments, lost cards, dietary policy, ...) in a ChatGPT-style web app. English only for v1. Every answer is templated or retrieved — there is no LLM call anywhere in the reply path.

| Part | What it is | Built with |
|---|---|---|
| `api/` | The backend: the three-layer reply pipeline, the REST API, the evaluation scripts | Python, FastAPI, SQLAlchemy, scikit-learn, pgvector |
| `web/` | The frontend: chat UI with a collapsible sidebar, a "thinking" pause, GSAP typed-out replies and feedback icons | Next.js 16, React 19, TypeScript, Tailwind 4, GSAP, lucide-react |
| Neon | The database: hosted Postgres with the `vector` extension | Postgres 18 |

This doc explains what exists, why each piece is shaped the way it is, and shows the one function that does the real work at each stage.

## Project structure

```
cafeteriaai/
├── api/
│   ├── app/
│   │   ├── main.py          FastAPI app: /health, /menu, /hours, CORS
│   │   ├── chat.py          POST /chat (runs the pipeline, logs it) and PUT /chat/{id}/rating
│   │   ├── nlp/             rules.py -> classifier.py -> retrieval.py, orchestrated by pipeline.py
│   │   ├── models.py        the four SQLAlchemy tables
│   │   ├── queries.py       menu / hours lookups
│   │   ├── schemas.py       request and response models
│   │   └── config.py        env vars + the tuned thresholds
│   ├── alembic/             schema migrations
│   ├── data/seed/           menu, hours, FAQ and intent-training CSVs
│   ├── scripts/             train_retrieval, train_classifier, seed_db
│   └── tests/               pipeline smoke test + input-validation tests
├── web/
│   ├── app/                 layout.tsx (wraps every page in the Shell), page.tsx, globals.css
│   ├── components/          Shell (sidebar), ChatView (input + messages), BotMessage (typing + feedback)
│   └── lib/                 api.ts (backend client), chats.ts (chat history store)
├── .env.example             DATABASE_URL and CORS_ORIGINS for the backend
└── README.md
```

## How a message travels

```
Browser (web/)                         FastAPI (api/)                          Neon
--------------                         ---------------                         ----
type + Enter
user bubble + "thinking" dots
        |------- POST /chat ----------> rules -> classifier -> retrieval ----> read menu / hours / FAQ
        |                                  |
 (dots stay at least 3 s)                  +-- log the exchange -------------> INSERT chat_messages
        |
reply arrives <---- {reply, suggestions, intent, source, message_id}
GSAP types it out, one character
after another; then thumbs up/down
        |
click a thumb ---- PUT /chat/{message_id}/rating --------------------------> UPDATE chat_messages.rating
```

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

    # `is None`, not `or`: Monday is 0, which is falsy, so `or` would silently
    # answer "what's on Monday" with today's menu.
    if HOURS_RE.search(normalized):
        day = resolve_day(normalized)
        if day is None:
            day = date.today().weekday()
        hours = queries.get_hours_for_day(db, day)
        return RuleResult(format_hours_reply(hours, day), intent="hours_query")

    if MENU_RE.search(normalized):
        day = resolve_day(normalized)
        if day is None:
            day = date.today().weekday()
        items = queries.get_menu_for_day(db, day)
        return RuleResult(format_menu_reply(items, day), intent="menu_query")

    return None  # nothing matched -- fall through to the classifier
```

One real bug this layer had and no longer has: the menu regex originally included the words "food" and "eat", which also show up in FAQ questions ("is the **food** halal") that have nothing to do with today's menu — those got hijacked into a menu dump instead of reaching retrieval. Fixed by dropping the two generic words and keeping only actual meal-time words (`menu|lunch|breakfast|dinner|serving|served`).

A second one, found by black-box testing: the greeting regex originally matched a greeting *anywhere* in the message, so "Hello, what's on the menu today?" got only a greeting back. It is now anchored (`^...$`): only a bare "hi" / "good morning" counts, and anything longer goes on to the hours and menu rules or the classifier.

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
    if not distance <= RETRIEVAL_DISTANCE_THRESHOLD:  # "not <=", not ">": see the NaN note below
        return None, distance
    return chunk, distance
```

Why plain TF-IDF and not a real sentence-embedding model (e.g. sentence-transformers): with only ~15-20 FAQ entries, there's no corpus large enough for a heavier model to meaningfully out-perform TF-IDF on, and `torch`/`transformers` would eat a large chunk of Render's free-tier 512MB RAM for that marginal gain. TF-IDF also skipped an extra dimensionality-reduction step (TruncatedSVD) that was in an earlier draft of this plan — same reasoning, not enough data for it to learn anything useful, and it was one more trained artifact to maintain for no measurable benefit. The embedding dimension itself (currently 61) isn't a round number either — it's the real vocabulary size measured by fitting the vectorizer on the actual FAQ questions, because guessing a dimension and hoping the real vocabulary matches it is exactly the kind of mismatch that silently breaks or silently degrades a retrieval system.

One guard worth knowing about: a query that shares no word with the FAQ vocabulary (say "asdf qwerty") embeds to the zero vector, and pgvector's cosine distance for a zero vector is `NaN`. `NaN > 0.6` is `False` in Python, so a plain `distance > threshold` check let such a query through and returned an arbitrary FAQ answer as if it were a confident match. `retrieval.search` therefore tests `not distance <= threshold`, which treats `NaN` as "no match" and falls back.

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

Base URL `http://localhost:8000`, JSON in and out, interactive docs at `/docs`.

| Endpoint | Purpose | Success |
|---|---|---|
| `GET /health` | Health check / pre-warm before a demo | `200 {"status": "ok"}` |
| `GET /menu?day_of_week=` | Today's menu by default, or any weekday (0 = Monday ... 6 = Sunday) | `200`, a list of menu items |
| `GET /hours` | The full weekly schedule | `200`, 7 entries ordered Monday to Sunday |
| `POST /chat` `{"message": "..."}` | Runs the pipeline above and logs the exchange | `200 {reply, suggestions[], intent, source, message_id}` |
| `PUT /chat/{message_id}/rating` `{"rating": 1 \| -1 \| null}` | Stores good / bad / cleared feedback on a logged reply | `204`, no body |

```
POST /chat  {"message": "is the food halal"}
200         {"reply": "Yes. All meat served in the cafeteria is halal-certified.",
             "suggestions": ["What's today's menu?", "What are your hours?", "I have some feedback"],
             "intent": "faq", "source": "retrieval", "message_id": 54}

PUT /chat/54/rating  {"rating": 1}   ->   204
```

`source` says which layer answered: `rule`, `classifier`, `retrieval` or `fallback`. Menu items carry `id, name, description, price, category, dietary_tags, day_of_week`; `price` is a decimal string such as `"140"`.

### Errors and input validation

Errors are JSON `{"detail": ...}`. A 422 names the field and the reason and never echoes what was sent.

| Status | When |
|---|---|
| `404` | A rating for a `message_id` that doesn't exist |
| `422` | `message` missing, not a string, longer than 1000 characters (the database column's limit) or containing a NUL byte; `rating` anything other than `1`, `-1` or `null` (`true`, `1.0` and `0` included); `message_id` below 1 or above 2,147,483,647; `day_of_week` outside 0-6 or not a number |

A browser can only call the API from an origin listed in `CORS_ORIGINS`; other origins are refused.

An independent black-box review of the running API (about 70 requests: every endpoint, malformed bodies, boundary values, CORS, injection and XSS strings, Unicode, parallel calls) found these cases, now fixed and covered by `tests/test_validation.py`: oversized, NUL-containing and lone-surrogate messages and out-of-range rating ids caused 500s; a query with no known words returned an arbitrary FAQ answer; and a greeting anywhere in a message hid the question after it. Injection and XSS strings were inert (replies never echo user input), Monday was handled correctly on every path, and 404/405 responses leak nothing. What it found and was deliberately left alone is listed under Known limitations.

## Frontend

`web/` is a Next.js 16 app (App Router, TypeScript, Tailwind 4) and a pure client of the API: no Next.js server code sits in the request path, the browser talks to FastAPI directly (which is why `CORS_ORIGINS` exists).

### What it does

- **ChatGPT-style layout.** `app/layout.tsx` wraps every page in `Shell`: a dark sidebar on the left (New chat, Recent chats) and the chat on the right. Clicking the logo hides or shows the sidebar; while it is hidden the logo stays in the top-left corner (turning into the panel icon on hover) so it can be brought back. On phones the sidebar is an overlay that starts closed.
- **Thinking, then writing.** Sending a message shows your bubble and three pulsing dots for at least 3 seconds. The API call runs in parallel, so a slower API simply takes as long as it takes. The reply is then written out with GSAP, one character after another (first, second, third, ...) at about 20 ms apiece. A long reply is sped up so it never takes more than 4 seconds, and it appears instantly for people whose OS asks for reduced motion.
- **Feedback.** Once the last character is in, thumbs-up and thumbs-down icons (lucide) fade in under the reply. A click stores `+1` / `-1` through `PUT /chat/{id}/rating`; clicking the same icon again clears it. The icon updates immediately and goes back if the request fails.
- **Suggestions.** The `suggestions` the API returns show as chips under the latest reply; clicking one sends it.
- **History.** Conversations are kept in the browser's `localStorage`. Past chats render instantly: only a reply that has just arrived is animated, and switching chats mid-reply never leaves the input locked.
- **Errors.** If the API can't be reached, the same 3-second wait is followed by a red "couldn't reach the server" message (no feedback icons on it).
- **Input.** Enter sends, Shift+Enter adds a line (an Enter that confirms an IME composition is ignored). The box grows with the text and is capped at 1000 characters, matching the database column.
- **Accessibility.** Screen readers get the full reply at once instead of one letter at a time; the thinking state is announced; icon buttons have labels and `aria-pressed`; all motion is switched off under `prefers-reduced-motion`.

### Where things live

| File | Role |
|---|---|
| `components/Shell.tsx` | Sidebar + page frame; desktop push-aside vs. mobile overlay |
| `components/ChatView.tsx` | Message list, input box, and the send flow: user bubble, API call, minimum thinking time, rating |
| `components/BotMessage.tsx` | One bot reply: the GSAP typing animation, feedback icons, suggestion chips |
| `lib/api.ts` | `sendChat` and `sendRating`; reads `NEXT_PUBLIC_API_URL` |
| `lib/chats.ts` | Chat history in `localStorage`, plus the `pending` / `fresh` flags below |

### A design detail worth knowing

Whether a reply gets typed out is decided at the moment it is added to the chat. If that flag lived in separate React state, React could render the new message one frame *before* the flag arrives and the animation would be skipped. So `chats.ts` keeps `pending` (a chat is waiting for a reply) and `fresh` (this message is being typed) in the same small store as the messages, and `addMessage` updates all of them in one commit. The store is read with `useSyncExternalStore`, so the server render and the first client render are both empty and the saved chats appear without a hydration mismatch.

### How it was checked

`npm run lint`, `tsc --noEmit` and `npm run build` pass (Next's Cache Components validation included). In a real browser against the live API: the thinking pause measured 3.0 s; a 57-character reply typed in 1.08 s (about 19 ms per character, progressively 2, 7, 14, ... 50 of 57 visible); the feedback icons appeared 80 ms after the last character; a rating click reached Neon (`chat_messages.rating = 1`); toggling and clearing a rating worked; the API-down path showed the error message; leaving a chat mid-reply unlocked the input; the phone layout opened as an overlay; and there were no console errors or warnings.

## Evaluation

The classifier is evaluated with **5-fold stratified cross-validation** (`sklearn.model_selection.cross_val_predict`), not a single train/test split — with only ~126 labeled examples, one split would leave the confusion matrix built from ~25 held-out points, too thin to mean much. Cross-validation gets an out-of-fold prediction for *every* labeled example (so nothing is ever scored by a model that trained on it) before the confusion matrix and classification report are built. The model that actually ships (`classifier.joblib`) is then fit once more on *all* the labeled data — cross-validation is only for the honest evaluation number, not for the deployed artifact. Artifacts land in `api/app/nlp/artifacts/`: `confusion_matrix.png`, `classification_report.txt`.

Retrieval doesn't get a second confusion matrix (the course wants one, clearly aimed at the classifier) — it's meant to be evaluated separately with hit-rate@1 over hand-written *paraphrases* of the stored FAQ questions (never the literal stored text, which would trivially score a perfect match and prove nothing). That evaluation set hasn't been written yet — see Limitations.

## Known limitations / deliberately out of scope

- **English only.** No Arabic/French support yet — a real decision, not an oversight, to ship something working before tackling code-switching.
- **No generative model anywhere.** Every reply is either a template filled from the DB or a retrieved FAQ answer verbatim. More natural-sounding, LLM-generated replies were considered and explicitly rejected for v1 (cost, latency, hallucination risk, and harder to evaluate).
- **Placeholder content.** `menu_seed.csv`, `hours_seed.csv`, `faq_seed.csv`, and `intents_train.csv` are all realistic-but-invented placeholders, not a real cafeteria's actual data. The training examples in particular are worth reviewing/extending with real phrasing before leaning on the confusion matrix too heavily in the report.
- **Retrieval's own evaluation set (paraphrased queries, hit-rate@1) hasn't been written yet** — only the classifier has a finished evaluation pipeline so far.
- **Single cafeteria, no accounts.** Anonymous chat, one location — both cheap assumptions to change later if they turn out to be wrong, not load-bearing design decisions.
- **The rules layer is keyword-greedy.** It fires on any message containing words like `lunch`, `served`, `open` or `close`, so feedback such as "the lunch was amazing" or "I sat close to the window" gets a menu or hours answer instead of reaching the classifier (two `feedback` rows in `intents_train.csv` can never get there for this reason). Fixes when it matters: let rules fire only on question-shaped messages, or let the classifier decide first.
- **Ramadan phrasing.** "Are your hours different during Ramadan" reaches the FAQ answer, but "what time do you open in ramadan" is let through by the rule and then routed by the classifier to the regular hours.
- **The retrieval threshold is loose.** A cosine distance of 0.6 over a 61-word vocabulary means a question that only shares words like "the cafeteria" with an FAQ can match it ("can visitors eat at the cafeteria" returns the payment answer). Tune it against the paraphrase evaluation set once that exists.
- **Server clock.** "Today" and "tomorrow" come from the server's local date. On a UTC host that is an hour behind Algeria (UTC+1), so between 00:00 and 01:00 local time the day is off by one; use `ZoneInfo("Africa/Algiers")` when deploying.
- **Menu answers list the whole day.** "What's for lunch tomorrow" returns every meal (grouped alphabetically: breakfast, dinner, lunch), and "any veggie options" returns the full menu. Filtering by meal or dietary tag is a later improvement.
- **No auth or rate limiting.** Anyone can call `/chat`, and with a sequential `message_id` anyone can overwrite a reply's rating. Fine for a course project; not for the open internet.
- **The 3-second "thinking" pause is cosmetic.** The API answers in about a second; the frontend deliberately keeps the dots up for at least 3 s (`THINK_MS` in `web/components/ChatView.tsx`) so a reply feels generated. Set it to `0` to remove it.
- **Chat history is per browser.** The sidebar's Recent list lives in `localStorage`; the backend is anonymous and has no notion of a conversation, so history doesn't follow you to another device or browser.
- **Deployment is a later round.** Both halves run locally against Neon; putting the API on Render and the web app on a host is not done yet.

## Local setup

You need Python 3.10+ (developed on 3.13), Node 20+ (developed on 24), and a Neon database (see "Database" below).

### 1. Backend (`api/`)

```bash
cd api
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
cp ../.env.example ../.env   # then paste your Neon connection string into DATABASE_URL (see "Database" below)

.venv/Scripts/python.exe -m alembic upgrade head      # creates the tables (and the vector extension) on Neon

# -m, not a bare path -- these import the app package, which needs api/ on sys.path
.venv/Scripts/python.exe -m scripts.train_retrieval    # fits FAQ embeddings -> artifacts/retrieval.joblib
.venv/Scripts/python.exe -m scripts.train_classifier   # trains intent classifier -> artifacts/classifier.joblib + confusion_matrix.png
.venv/Scripts/python.exe -m scripts.seed_db            # loads menu/hours/faqs (with embeddings) into DB

.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

(Commands above work as-is in Git Bash on Windows. In PowerShell, use `.venv\Scripts\python.exe` instead. On Linux, macOS, or WSL the venv puts the interpreter at `.venv/bin/python`, so swap that in.)

The trained artifacts (`*.joblib`, `confusion_matrix.png`, `classification_report.txt`) are git-ignored, so a fresh clone has none of them -- the two `scripts.train_*` commands above generate them, and `scripts.seed_db` needs `retrieval.joblib` to exist first.

The API is now on `http://localhost:8000` (FastAPI's interactive docs are at `/docs`). Run the tests with `.venv/Scripts/python.exe -m pytest tests`: `test_validation.py` is pure logic (no database); `test_pipeline.py` is the end-to-end smoke test and needs the migrated and seeded database above. Its requests only read; a `/chat` call, by contrast, logs a row to `chat_messages`.

### 2. Frontend (`web/`)

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

The frontend calls the API straight from the browser. It looks for it at `http://localhost:8000`; to point somewhere else, copy `web/.env.example` to `web/.env.local` and set `NEXT_PUBLIC_API_URL`. The backend must allow the frontend's origin: `CORS_ORIGINS` in the root `.env` (default `http://localhost:3000`) — without it the browser blocks every API call.

Checks before committing frontend changes: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

### Configuration

| Variable | File | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | root `.env` | none (required) | Neon connection string, `postgresql+psycopg://...` (see "Database") |
| `CORS_ORIGINS` | root `.env` | `http://localhost:3000` | Comma-separated origins allowed to call the API from a browser |
| `NEXT_PUBLIC_API_URL` | `web/.env.local` | `http://localhost:8000` | Where the frontend finds the API. It ends up in the browser bundle, so it is a URL, never a secret |

## Database

The only database is [Neon](https://neon.tech) (hosted Postgres with pgvector) -- there is no local database to run. Local development and the deployed app both read the same `DATABASE_URL` env var. The `chat_messages` table is the evaluation audit trail, so to keep your test chats out of it, point local development at a Neon *branch* (an instant isolated copy) and leave the main branch to the deployed app.

Neon's dashboard hands you a URL starting with `postgresql://`, but this app uses psycopg 3, so the prefix must be rewritten to `postgresql+psycopg://` (a bare `postgresql://` makes SQLAlchemy look for psycopg2, which isn't installed). Keep the `?sslmode=require&channel_binding=require` suffix as-is. Use Neon's direct/unpooled connection string, not the `-pooler` one (the dashboard defaults to pooled -- delete `-pooler` from the host) — nothing about this project's traffic needs connection pooling yet, and pooled connections are known to break prepared statements mid-seed. Neon needs the `vector` extension enabled, which the initial Alembic migration already does with `CREATE EXTENSION IF NOT EXISTS vector`.

## Build history

The project was built in stages, one commit and one push per stage, so `git log` reads as the build order:

| Stage | What it added |
|---|---|
| 1 | Foundation: config, DB session, models, Alembic migration, queries, menu and hours seeds |
| 2 | Rules layer: regex routing with direct DB lookup |
| 3 | Intent classifier with a cross-validated evaluation |
| 4 | FAQ retrieval (pgvector) and database seeding |
| 5 | Pipeline orchestration and the FastAPI endpoints, with chat logging |
| 6 | `PUT /chat/{id}/rating` for feedback |
| 7 | Next.js scaffold and the API client |
| 8 | ChatGPT-style layout, collapsible sidebar, working chat |
| 9 | Thinking delay, GSAP typed replies, feedback icons |

Smaller commits in between: the README, replacing local Docker with Neon, and the input-validation fixes from the API review.

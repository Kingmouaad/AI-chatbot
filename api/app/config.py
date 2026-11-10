import os

from dotenv import load_dotenv

load_dotenv()

# No fallback on purpose: with no local database anymore, a silent localhost default
# would only turn a missing .env into a confusing "connection refused".
_url = os.environ["DATABASE_URL"]
# The web app (node-postgres) needs "postgresql://", this app (psycopg 3) needs "postgresql+psycopg://".
# Accept either so Vercel can share one DATABASE_URL between both services.
DATABASE_URL = _url.replace("postgresql://", "postgresql+psycopg://", 1) if _url.startswith("postgresql://") else _url

# On Vercel both services share one domain and this one is reached under /backend (see vercel.json);
# Vercel passes the request path through unchanged, so the routes must carry that prefix themselves.
# Locally uvicorn serves them at the root.
API_PREFIX = "/backend" if os.environ.get("VERCEL") else ""
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")]

# Tuned against cross-validated out-of-fold confidence, not guessed: on the
# placeholder training set, correct predictions have median confidence ~0.40
# and wrong ones ~0.29 -- the two distributions overlap heavily at this data
# size (126 examples / 5 classes), so there's no clean separating value.
# 0.3 sits near correct predictions' 10th percentile, keeping most genuinely
# correct calls while still filtering the lowest-confidence guesses. Revisit
# once chat_messages provides a larger, real training set.
CLASSIFIER_CONFIDENCE_THRESHOLD = 0.3
RETRIEVAL_DISTANCE_THRESHOLD = 0.6
# Measured, not guessed: vocabulary size of TfidfVectorizer fit on faq_seed.csv
# (scripts/train_retrieval.py). Changing faq_seed.csv changes this number --
# re-run that script and update this + the Alembic migration together.
EMBEDDING_DIM = 61

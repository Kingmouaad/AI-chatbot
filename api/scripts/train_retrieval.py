import csv
import pathlib

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = pathlib.Path(__file__).resolve().parents[1]
FAQ_CSV = ROOT / "data" / "seed" / "faq_seed.csv"
ARTIFACT_DIR = ROOT / "app" / "nlp" / "artifacts"


def load_questions():
    with open(FAQ_CSV, newline="", encoding="utf-8") as f:
        return [row["question"] for row in csv.DictReader(f)]


def main():
    questions = load_questions()
    vectorizer = TfidfVectorizer()
    vectorizer.fit(questions)
    dim = len(vectorizer.vocabulary_)

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(vectorizer, ARTIFACT_DIR / "retrieval.joblib")

    print(f"Fitted TF-IDF vectorizer on {len(questions)} FAQ questions.")
    print(f"EMBEDDING_DIM = {dim}")


if __name__ == "__main__":
    main()

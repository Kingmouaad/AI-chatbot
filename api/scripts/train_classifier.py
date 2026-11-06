import csv
import pathlib

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import ConfusionMatrixDisplay, classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRAIN_CSV = ROOT / "data" / "seed" / "intents_train.csv"
ARTIFACT_DIR = ROOT / "app" / "nlp" / "artifacts"


def load_data() -> tuple[list[str], list[str]]:
    texts, labels = [], []
    with open(TRAIN_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            texts.append(row["text"])
            labels.append(row["intent"])
    return texts, labels


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            ("tfidf", TfidfVectorizer()),
            ("clf", LogisticRegression(max_iter=1000)),
        ]
    )


def main() -> None:
    texts, labels = load_data()
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    # Evaluation: out-of-fold predictions for every labeled example (not a single
    # train/test split -- too little data for one split to mean much), so the
    # confusion matrix/report reflect every point without ever scoring a model
    # on data it trained on.
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    predicted = cross_val_predict(build_pipeline(), texts, labels, cv=cv)

    report = classification_report(labels, predicted)
    print(report)
    (ARTIFACT_DIR / "classification_report.txt").write_text(report, encoding="utf-8")

    labels_sorted = sorted(set(labels))
    cm = confusion_matrix(labels, predicted, labels=labels_sorted)
    ConfusionMatrixDisplay(cm, display_labels=labels_sorted).plot(xticks_rotation=45)
    plt.tight_layout()
    plt.savefig(ARTIFACT_DIR / "confusion_matrix.png")
    plt.close()

    # What ships: one final fit on ALL labeled data. Cross-validation above is
    # only for the honest evaluation number, not for the deployed artifact.
    final_pipeline = build_pipeline()
    final_pipeline.fit(texts, labels)
    joblib.dump(final_pipeline, ARTIFACT_DIR / "classifier.joblib")
    print(f"\nSaved classifier ({len(texts)} examples) to {ARTIFACT_DIR / 'classifier.joblib'}")


if __name__ == "__main__":
    main()

import re
from datetime import date, timedelta

from app import queries

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Anchored: only a message that is *just* a greeting counts. "hi, what time do you close?" is an
# hours question, and must reach the hours rule instead of being swallowed by a greeting reply.
GREETING_RE = re.compile(
    r"^\W*(?:hi|hello|hey|good morning|good afternoon|good evening)(?:\W+(?:there|everyone|all))?\W*$",
    re.I,
)
HOURS_RE = re.compile(r"\b(hours?|open|close|closing|opening)\b", re.I)
# "food"/"eat" deliberately excluded -- too generic, they also appear in FAQ
# questions ("is the food halal") that have nothing to do with today's menu.
MENU_RE = re.compile(r"\b(menu|lunch|breakfast|dinner|serving|served)\b", re.I)
RAMADAN_RE = re.compile(r"\bramadan\b", re.I)


class RuleResult:
    def __init__(self, reply: str, intent: str):
        self.reply = reply
        self.intent = intent


def resolve_day(text: str) -> int | None:
    lowered = text.lower()
    if "tomorrow" in lowered:
        return (date.today() + timedelta(days=1)).weekday()
    if "today" in lowered:
        return date.today().weekday()
    for i, day in enumerate(WEEKDAYS):
        if day.lower() in lowered:
            return i
    return None


def format_menu_reply(items: list, day: int) -> str:
    if not items:
        return f"I don't have a menu for {WEEKDAYS[day]} yet."
    lines = [f"{item.name} ({item.category}, {item.price} DA)" for item in items]
    return f"On {WEEKDAYS[day]}: " + "; ".join(lines) + "."


def format_hours_reply(hours, day: int) -> str:
    if hours is None:
        return f"I don't have hours for {WEEKDAYS[day]}."
    note = f" ({hours.note})" if hours.note else ""
    return (
        f"On {WEEKDAYS[day]}, we're open from {hours.open_time.strftime('%H:%M')} "
        f"to {hours.close_time.strftime('%H:%M')}{note}."
    )


def match(text: str, db) -> RuleResult | None:
    normalized = text.lower().strip()

    # ponytail: only the named Ramadan case is special-cased here, not a general
    # holiday-override system -- a static FAQ answer (faq_seed.csv) covers it via
    # the classifier -> retrieval path instead.
    if RAMADAN_RE.search(normalized) and HOURS_RE.search(normalized):
        return None

    if GREETING_RE.search(normalized):
        return RuleResult(
            "Hi! Ask me about today's menu, our hours, or anything else about the cafeteria.",
            intent="greeting",
        )

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

    return None

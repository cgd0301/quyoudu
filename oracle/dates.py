"""Beijing-time date helpers used by the deterministic engine."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone


BEIJING = timezone(timedelta(hours=8))


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def parse_time(value: str, *, allow_date: bool = True) -> datetime:
    if "T" not in value:
        if not allow_date:
            raise ValueError("a timezone-aware datetime is required")
        return datetime.combine(parse_date(value), datetime.min.time(), tzinfo=BEIJING)
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(hours=8):
        raise ValueError("datetime must carry the +08:00 offset")
    return parsed


def as_date(value: str) -> date:
    return parse_time(value).date()


def days_inclusive(start: date, end: date) -> list[date]:
    if end < start:
        return []
    return [start + timedelta(days=index) for index in range((end - start).days + 1)]


def date_text(value: date) -> str:
    return value.isoformat()


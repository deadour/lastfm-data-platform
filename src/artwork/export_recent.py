"""recent.json v1 (frontend/docs/recent-data-contract.md): what I listened to lately.

Inputs are the committed Silver snapshot and the reviewed artwork catalog, the
same ones used for stats.json, so the three files describe one release.

Time handling
- Every event is converted from UTC to ``America/Argentina/Cordoba`` before
  bucketing (fixed UTC-3, no DST). The months in France (Jan–Jun 2026) are
  bucketed in that same zone here; a play near midnight in Paris can land on
  the neighbouring day. The historical insights keep their own per-period zones
  and are not affected.
- ``today`` is the calendar day at export time. Weeks start on Monday and
  months on the 1st. Current windows are ``complete: false``; ``last_week`` and
  ``last_month`` are complete.
- Buckets after the data's coverage date (when Silver was last built) are
  ``null``: unknown, not zero. Buckets before consistent tracking (2020) would
  also be ``null``; recent windows never reach that far today.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from .export_frontend import cover
from .matching import album_key

SCHEMA_VERSION = 1
ZONE = "America/Argentina/Cordoba"
TOP = 5


def load_events(silver_path: Path) -> pd.DataFrame:
    events = pd.read_parquet(silver_path, columns=["artist_name", "track_name", "album_name", "scrobbled_at"])
    local = pd.to_datetime(events["scrobbled_at"], utc=True).dt.tz_convert(ZONE)
    events = events.assign(day=local.dt.date, album_name=events["album_name"].fillna("").astype(str).str.strip())
    return events


def _ranked(counts: pd.Series, n: int = TOP) -> list[tuple[Any, int]]:
    """Highest count first; ties broken by the label so output is deterministic."""
    frame = counts.rename("n").reset_index()
    keys = [c for c in frame.columns if c != "n"]
    frame = frame.sort_values(["n", *keys], ascending=[False, *([True] * len(keys))], kind="stable")
    return [(tuple(r[k] for k in keys) if len(keys) > 1 else r[keys[0]], int(r["n"])) for _, r in frame.head(n).iterrows()]


def period(events: pd.DataFrame, start: date, end_exclusive: date, complete: bool, lookup,
           covered: date | None = None) -> dict[str, Any]:
    window = events[(events["day"] >= start) & (events["day"] < end_exclusive)]
    albums = window[window["album_name"] != ""]
    return {
        "start": start.isoformat(), "end_exclusive": end_exclusive.isoformat(), "complete": complete,
        # "unknown": the window starts after the last processed data, so zeros are not real zeros
        "status": "unknown" if covered is not None and start > covered else "covered",
        "scrobbles": int(len(window)),
        "unique_artists": int(window["artist_name"].nunique()),
        "unique_tracks": int(window[["artist_name", "track_name"]].drop_duplicates().shape[0]),
        "unique_albums": int(albums[["artist_name", "album_name"]].drop_duplicates().shape[0]),
        "top_artists": [{"name": a, "scrobbles": c} for a, c in _ranked(window.groupby("artist_name").size())] if len(window) else [],
        "top_albums": [{"artist": a, "title": t, "scrobbles": c, "cover": lookup(a, t)}
                       for (a, t), c in _ranked(albums.groupby(["artist_name", "album_name"]).size())] if len(albums) else [],
        "top_tracks": [{"artist": a, "title": t, "scrobbles": c}
                       for (a, t), c in _ranked(window.groupby(["artist_name", "track_name"]).size())] if len(window) else [],
    }


def _month_start(day: date, back: int = 0) -> date:
    y, m = day.year, day.month - back
    while m <= 0:
        y, m = y - 1, m + 12
    return date(y, m, 1)


def _next_month(day: date) -> date:
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


def build_recent(silver_path: Path, catalog: pd.DataFrame, data_as_of: str, tracked_from: date = date(2020, 1, 1),
                 now: datetime | None = None) -> dict[str, Any]:
    events = load_events(silver_path)
    indexed = catalog.set_index("album_key") if len(catalog) else pd.DataFrame(columns=catalog.columns)

    def lookup(artist: str, album: str):
        key = album_key(artist, album)
        return cover(indexed.loc[key]) if key in indexed.index else None

    now = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(ZONE))
    today = now.date()
    covered = pd.Timestamp(data_as_of).tz_convert(ZONE).date()
    week = today - timedelta(days=today.weekday())
    month = today.replace(day=1)
    previous_month = _month_start(today, 1)
    per_day = events.groupby("day").size()

    def total(start: date, end_exclusive: date) -> int | None:
        if start > covered or start < tracked_from:
            return None  # outside known tracking: unknown, not zero
        return int(per_day[(per_day.index >= start) & (per_day.index < end_exclusive)].sum())

    last = events.loc[pd.to_datetime(events["scrobbled_at"], utc=True).idxmax()] if len(events) else None
    last_scrobble = None if last is None else {
        "artist": last["artist_name"], "title": last["track_name"], "album": last["album_name"] or None,
        "played_at": pd.Timestamp(last["scrobbled_at"]).tz_convert("UTC").isoformat().replace("+00:00", "Z"),
        "cover": lookup(last["artist_name"], last["album_name"]) if last["album_name"] else None,
    }
    days = [today - timedelta(days=13 - i) for i in range(14)]
    weeks = [week - timedelta(weeks=11 - i) for i in range(12)]
    months = [_month_start(today, 11 - i) for i in range(12)]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "data_as_of": data_as_of,
        "timezone": ZONE,
        "coverage_until": covered.isoformat(),
        # fallback for the live widget when last.fm's recent tracks api is down
        "last_scrobble": last_scrobble,
        "periods": {
            "today": period(events, today, today + timedelta(days=1), False, lookup, covered),
            "this_week": period(events, week, week + timedelta(days=7), False, lookup, covered),
            "last_week": period(events, week - timedelta(days=7), week, True, lookup, covered),
            "this_month": period(events, month, _next_month(month), False, lookup, covered),
            "last_month": period(events, previous_month, month, True, lookup, covered),
        },
        "series": {
            "days": [{"date": d.isoformat(), "scrobbles": total(d, d + timedelta(days=1)), "complete": d < today} for d in days],
            "weeks": [{"start": w.isoformat(), "scrobbles": total(w, w + timedelta(days=7)), "complete": w < week} for w in weeks],
            "months": [{"month": m.strftime("%Y-%m"), "scrobbles": total(m, _next_month(m)), "complete": m < month} for m in months],
        },
    }

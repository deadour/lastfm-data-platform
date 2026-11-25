"""Deeper, wrapped-style reads of the listening history for the frontend.

Writes two kinds of static files next to stats.json:

- ``insights.json``: findings that need the scrobble-level history (busiest day,
  single-day obsessions, binges, sessions, comebacks, discoveries per year,
  hour/weekday habits in local time) plus an index of explorable artists.
- ``artists/<slug>.json``: one page of detail per top artist.

Inputs are the same committed Silver snapshot and artwork catalog used for
stats.json, so every number is traceable to the pipeline. Hours use the
historical local time zones in ``config/timezone_periods.json``; the canonical
UTC timestamp is not changed. Like stats.json, the output carries aggregates
and public cover URLs only.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd

from src.analytics.historical_time import add_historical_local_time

from .export_frontend import cover, write
from .matching import album_key

SCHEMA_VERSION = 1
SESSION_GAP = pd.Timedelta("30min")


def slug(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:60] or "artista"


def _day(value) -> str:
    return pd.Timestamp(value).date().isoformat()


def _round(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def load_events(silver_path: Path, timezone_config: Path) -> pd.DataFrame:
    events = pd.read_parquet(silver_path, columns=["artist_name", "track_name", "album_name", "scrobbled_at"])
    events = add_historical_local_time(events, timezone_config)
    events["album_name"] = events["album_name"].fillna("").astype(str).str.strip()
    return events.sort_values("scrobbled_at", kind="stable").reset_index(drop=True)


def _covers(catalog: pd.DataFrame):
    indexed = catalog.set_index("album_key") if len(catalog) else pd.DataFrame(columns=catalog.columns)

    def lookup(artist: str, album: str) -> dict[str, Any] | None:
        key = album_key(artist, album) if album else ""
        return cover(indexed.loc[key]) if key in indexed.index else None
    return lookup


def busiest_day(events: pd.DataFrame) -> dict[str, Any]:
    per_day = events.groupby("local_date").size()
    day = per_day.idxmax()
    rows = events[events["local_date"] == day]
    return {"date": _day(day), "scrobbles": int(per_day.max()),
            "top_artist": rows["artist_name"].value_counts().index[0]}


def obsession(events: pd.DataFrame) -> dict[str, Any]:
    """The most times one song was played in a single day."""
    counts = events.groupby(["local_date", "artist_name", "track_name"]).size().rename("n").reset_index()
    top = counts.sort_values(["n", "local_date"], ascending=[False, True]).iloc[0]
    return {"title": top.track_name, "artist": top.artist_name, "date": _day(top.local_date), "plays": int(top.n)}


def binge(events: pd.DataFrame) -> dict[str, Any]:
    """Longest run of consecutive scrobbles by the same artist."""
    # string dtype compares the first row with <NA>; a new run starts there too
    change = events["artist_name"].ne(events["artist_name"].shift()).fillna(True).astype(bool)
    runs = events.assign(run=change.cumsum()).groupby("run").agg(
        artist=("artist_name", "first"), plays=("artist_name", "size"), start=("scrobbled_at_local", "first"))
    top = runs.sort_values(["plays", "start"], ascending=[False, True]).iloc[0]
    return {"artist": top.artist, "plays": int(top.plays), "date": _day(top.start)}


def longest_session(events: pd.DataFrame) -> dict[str, Any]:
    """Scrobbles separated by less than 30 minutes form one listening session."""
    gap = events["scrobbled_at"].diff().gt(SESSION_GAP) | events["scrobbled_at"].diff().isna()
    sessions = events.assign(session=gap.cumsum()).groupby("session").agg(
        plays=("artist_name", "size"), start=("scrobbled_at", "first"), end=("scrobbled_at", "last"),
        local=("scrobbled_at_local", "first"), artists=("artist_name", "nunique"))
    sessions["minutes"] = (sessions["end"] - sessions["start"]).dt.total_seconds() / 60
    top = sessions.sort_values(["minutes", "plays"], ascending=[False, False]).iloc[0]
    return {"date": _day(top.local), "hours": _round(top.minutes / 60, 1), "plays": int(top.plays),
            "artists": int(top.artists), "sessions": int(len(sessions)),
            "median_plays": int(sessions["plays"].median())}


def comebacks(events: pd.DataFrame, tracked_from: pd.Timestamp | None = None, limit: int = 6,
              min_gap_days: int = 365, min_after: int = 25) -> list[dict[str, Any]]:
    """Artists that disappeared for at least a year and came back with real plays.

    Only the consistently tracked era counts: a gap in scrobbling itself (the
    2016–2020 hole) is not the listener leaving an artist.
    """
    if tracked_from is not None:
        events = events[events["scrobbled_at"] >= tracked_from]
    rows = []
    for artist, group in events.groupby("artist_name", sort=False):
        days = pd.Series(pd.to_datetime(group["local_date"].unique())).sort_values().reset_index(drop=True)
        if len(days) < 2:
            continue
        gaps = days.diff().dt.days
        index = int(gaps.idxmax()) if gaps.notna().any() else None
        if index is None or gaps[index] < min_gap_days:
            continue
        after = int((pd.to_datetime(group["local_date"]) >= days[index]).sum())
        if after >= min_after:
            rows.append({"artist": artist, "gap_days": int(gaps[index]), "left": _day(days[index - 1]),
                         "returned": _day(days[index]), "plays_after": after})
    return sorted(rows, key=lambda r: (-r["gap_days"] * r["plays_after"], r["artist"]))[:limit]


def one_year_loves(events: pd.DataFrame, limit: int = 6, min_plays: int = 120, share: float = 0.8) -> list[dict[str, Any]]:
    """Artists whose plays concentrate in a single year: a phase."""
    per = events.groupby(["artist_name", "local_year"]).size().rename("n").reset_index()
    totals = per.groupby("artist_name")["n"].sum()
    best = per.sort_values("n", ascending=False).drop_duplicates("artist_name").set_index("artist_name")
    best["total"] = totals
    best = best[(best["total"] >= min_plays) & (best["n"] / best["total"] >= share)]
    best = best.sort_values(["total", "local_year"], ascending=[False, True]).head(limit)
    return [{"artist": artist, "year": int(r.local_year), "plays": int(r.total), "share": _round(r.n / r.total, 3)}
            for artist, r in best.iterrows()]


def constants(events: pd.DataFrame, limit: int = 6) -> list[dict[str, Any]]:
    """Artists present in the most distinct years."""
    years = events.groupby("artist_name").agg(years=("local_year", "nunique"), plays=("local_year", "size"))
    years = years.sort_values(["years", "plays"], ascending=[False, False]).head(limit)
    return [{"artist": artist, "years": int(r.years), "plays": int(r.plays)} for artist, r in years.iterrows()]


def first_ever(events: pd.DataFrame) -> dict[str, Any]:
    row = events.iloc[0]
    return {"title": row.track_name, "artist": row.artist_name, "date": _day(row.scrobbled_at_local)}


def habits(events: pd.DataFrame) -> dict[str, Any]:
    total = len(events)
    hours = events.groupby("local_hour").size().reindex(range(24), fill_value=0)
    weekdays = events.groupby("local_weekday").size().reindex(range(7), fill_value=0)
    night = events["local_hour"].isin([0, 1, 2, 3, 4, 5]).sum()
    weekend = events["local_weekday"].isin([5, 6]).sum()
    top10 = events["artist_name"].value_counts().head(10).sum()
    return {"hours": [_round(v / total, 5) for v in hours], "weekdays": [_round(v / total, 5) for v in weekdays],
            "peak_hour": int(hours.idxmax()), "night_share": _round(night / total, 3),
            "weekend_share": _round(weekend / total, 3), "top10_share": _round(top10 / total, 3)}


def years(events: pd.DataFrame, lookup, partial: set[int]) -> list[dict[str, Any]]:
    """Per year: what defined it, and what was discovered in it."""
    first_year = events.groupby("artist_name")["local_year"].min()
    total_by_artist = events["artist_name"].value_counts()
    out = []
    for year, group in events.groupby("local_year"):
        new = first_year[first_year == year].index
        discovery = total_by_artist.reindex(new).sort_values(ascending=False)
        albums = group[group["album_name"] != ""].groupby(["artist_name", "album_name"]).size().sort_values(ascending=False)
        tracks = group.groupby(["artist_name", "track_name"]).size().sort_values(ascending=False)
        artist_counts = group["artist_name"].value_counts()
        album = albums.index[0] if len(albums) else None
        out.append({
            "year": int(year), "scrobbles": int(len(group)), "partial": int(year) in partial,
            "artists": int(group["artist_name"].nunique()), "new_artists": int(len(new)),
            "top_artist": artist_counts.index[0], "top_artist_share": _round(artist_counts.iloc[0] / len(group), 3),
            "top_track": {"title": tracks.index[0][1], "artist": tracks.index[0][0], "plays": int(tracks.iloc[0])},
            "top_album": None if album is None else {"title": album[1], "artist": album[0], "plays": int(albums.iloc[0]),
                                                     "cover": lookup(album[0], album[1])},
            "discovery": None if discovery.empty else {"artist": discovery.index[0], "plays": int(discovery.iloc[0])},
        })
    return out


def artist_page(name: str, group: pd.DataFrame, rank: int, total: int, lookup, months: list[str],
                photo: dict[str, Any] | None = None) -> dict[str, Any]:
    per_year = group.groupby("local_year").size()
    per_month = group.assign(m=group["scrobbled_at_local"].dt.strftime("%Y-%m")).groupby("m").size()
    tracks = group.groupby("track_name").size().sort_values(ascending=False)
    albums = group[group["album_name"] != ""].groupby("album_name").size().sort_values(ascending=False)
    hours = group.groupby("local_hour").size().reindex(range(24), fill_value=0)
    day = group.groupby("local_date").size()
    first = group.iloc[0]
    return {
        "schema_version": SCHEMA_VERSION, "slug": slug(name), "name": name, "rank": rank, "photo": photo,
        "scrobbles": int(len(group)), "share": _round(len(group) / total, 4),
        "tracks": int(group["track_name"].nunique()), "albums": int(albums.size),
        "first": {"date": _day(first.scrobbled_at_local), "title": first.track_name},
        "last": _day(group.iloc[-1].scrobbled_at_local),
        "peak_year": int(per_year.idxmax()), "active_years": int(per_year.size),
        "best_day": {"date": _day(day.idxmax()), "plays": int(day.max())},
        "years": [{"year": int(y), "scrobbles": int(c)} for y, c in per_year.items()],
        "months": [int(per_month.get(m, 0)) for m in months],
        "hours": [int(v) for v in hours],
        "top_tracks": [{"title": t, "plays": int(c)} for t, c in tracks.head(12).items()],
        "top_albums": [{"title": a, "plays": int(c), "cover": lookup(name, a)} for a, c in albums.head(8).items()],
    }


def build_insights(silver_path: Path, catalog: pd.DataFrame, partial_years: set[int],
                   timezone_config: Path = Path("config/timezone_periods.json"),
                   analytics_config: Path = Path("config/analytics.json"),
                   artist_pages: int = 60, photos=None) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    photos = photos or (lambda name: None)
    events = load_events(silver_path, timezone_config)
    tracked_from = pd.Timestamp(json.loads(analytics_config.read_text(encoding="utf-8"))["consistent_tracking_from"], tz="UTC")
    lookup = _covers(catalog)
    total = len(events)
    first_month = events["scrobbled_at_local"].min().to_period("M")
    last_month = events["scrobbled_at_local"].max().to_period("M")
    months = [str(p) for p in pd.period_range(first_month, last_month, freq="M")]
    ranking = events["artist_name"].value_counts()
    pages, index = {}, []
    by_artist = dict(tuple(events.groupby("artist_name", sort=False)))
    used: set[str] = set()
    for rank, (name, plays) in enumerate(ranking.head(artist_pages).items(), start=1):
        page = artist_page(name, by_artist[name], rank, total, lookup, months, photos(name))
        while page["slug"] in used:
            page["slug"] = f"{page['slug']}-{rank}"
        used.add(page["slug"])
        pages[page["slug"]] = page
        best = next((a["cover"] for a in page["top_albums"] if a["cover"]), None)
        index.append({"slug": page["slug"], "name": name, "rank": rank, "scrobbles": int(plays),
                      "peak_year": page["peak_year"], "photo": page["photo"],
                      "image": best["url"] if best else None})
    document = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "months": months,
        "monthly": [int(v) for v in events.assign(m=events["scrobbled_at_local"].dt.strftime("%Y-%m"))
                    .groupby("m").size().reindex(months, fill_value=0)],
        "first_ever": first_ever(events),
        "busiest_day": busiest_day(events),
        "obsession": obsession(events),
        "binge": binge(events),
        "session": longest_session(events),
        "habits": habits(events),
        "comebacks": comebacks(events, tracked_from),
        "phases": one_year_loves(events),
        "constants": constants(events),
        "years": years(events, lookup, partial_years),
        "artists": index,
    }
    return document, pages


def write_all(document: dict[str, Any], pages: dict[str, dict[str, Any]], out_dir: Path) -> None:
    write(document, out_dir / "insights.json")
    for name, page in pages.items():
        write(page, out_dir / "artists" / f"{name}.json")


def top_artist_names(silver_path: Path, limit: int = 60) -> list[str]:
    names = pd.read_parquet(silver_path, columns=["artist_name"])["artist_name"]
    return list(names.value_counts().head(limit).index)

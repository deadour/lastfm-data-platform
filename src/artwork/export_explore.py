"""Exploration reads for the frontend: recent windows, calendar, genres, rarities.

All functions take the local-time event frame built by ``export_insights`` and
return small JSON-ready structures. "Recent" is anchored to the last day with
data, not to the wall clock, so a late pipeline run never shows an empty week.
Genres come from ``cloud_genres.Genres``; plays of artists without tags are
reported as coverage instead of being guessed.
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd


_EMOJI = re.compile("[🀀-🫿☀-➿]")


def looks_like_artist(name: str) -> bool:
    """Drop obvious youtube video titles that got scrobbled as artists."""
    text = str(name)
    return len(text) <= 45 and not _EMOJI.search(text) and text.count("?") < 2 and '"' not in text


def _r(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def _day(value) -> str:
    return pd.Timestamp(value).date().isoformat()


def _top(series: pd.Series, n: int, key: str = "name") -> list[dict[str, Any]]:
    return [{key: k, "plays": int(v)} for k, v in series.sort_values(ascending=False, kind="stable").head(n).items()]


def _tracks(frame: pd.DataFrame, n: int) -> list[dict[str, Any]]:
    counts = frame.groupby(["artist_name", "track_name"]).size().sort_values(ascending=False, kind="stable").head(n)
    return [{"title": t, "artist": a, "plays": int(c)} for (a, t), c in counts.items()]


def window(events: pd.DataFrame, end: pd.Timestamp, days: int, genres=None) -> dict[str, Any]:
    """The ``days`` local days ending at ``end`` (inclusive), compared with the window before."""
    dates = pd.to_datetime(events["local_date"])
    start = end - pd.Timedelta(days=days - 1)
    current = events[(dates >= start) & (dates <= end)]
    previous = events[(dates >= start - pd.Timedelta(days=days)) & (dates < start)]
    first_seen = pd.to_datetime(events.groupby("artist_name")["local_date"].min())
    new = [a for a in first_seen[(first_seen >= start) & (first_seen <= end)].index if looks_like_artist(a)]
    new_plays = current[current["artist_name"].isin(new)]["artist_name"].value_counts()
    daily = current.groupby(pd.to_datetime(current["local_date"])).size()
    out = {
        "from": _day(start), "to": _day(end), "plays": int(len(current)), "previous_plays": int(len(previous)),
        "artists": int(current["artist_name"].nunique()), "tracks": int(current["track_name"].nunique()),
        "daily": [int(daily.get(d, 0)) for d in pd.date_range(start, end, freq="D")],
        "top_artists": _top(current["artist_name"].value_counts(), 10),
        "top_tracks": _tracks(current, 10),
        "new_artists": _top(new_plays, 10),
    }
    if genres is not None:
        out["genres"] = family_shares(current, genres)["families"][:6]
    return out


def last_day(events: pd.DataFrame, end: pd.Timestamp) -> dict[str, Any]:
    day = events[pd.to_datetime(events["local_date"]) == end]
    hours = day.groupby("local_hour").size().reindex(range(24), fill_value=0)
    return {"date": _day(end), "plays": int(len(day)), "artists": int(day["artist_name"].nunique()),
            "first": None if day.empty else {"title": day.iloc[0].track_name, "artist": day.iloc[0].artist_name,
                                             "time": day.iloc[0].scrobbled_at_local.strftime("%H:%M")},
            "last": None if day.empty else {"title": day.iloc[-1].track_name, "artist": day.iloc[-1].artist_name,
                                            "time": day.iloc[-1].scrobbled_at_local.strftime("%H:%M")},
            "hours": [int(v) for v in hours],
            "top_artists": _top(day["artist_name"].value_counts(), 5), "top_tracks": _tracks(day, 10)}


def recent(events: pd.DataFrame, genres=None) -> dict[str, Any]:
    end = pd.Timestamp(pd.to_datetime(events["local_date"]).max())
    return {"anchor": _day(end), "day": last_day(events, end),
            "week": window(events, end, 7, genres), "month": window(events, end, 30, genres)}


def calendar(events: pd.DataFrame, days: int = 371) -> dict[str, Any]:
    """Daily plays for the last ~53 weeks, for a contribution-style grid."""
    end = pd.Timestamp(pd.to_datetime(events["local_date"]).max())
    start = end - pd.Timedelta(days=days - 1)
    daily = events.groupby(pd.to_datetime(events["local_date"])).size()
    counts = [int(daily.get(d, 0)) for d in pd.date_range(start, end, freq="D")]
    return {"start": _day(start), "end": _day(end), "counts": counts, "max": max(counts) if counts else 0}


def family_shares(events: pd.DataFrame, genres) -> dict[str, Any]:
    """Plays split across genre families by each artist's family weights."""
    plays = events["artist_name"].value_counts()
    weights: dict[str, float] = {}
    covered = 0
    for artist, count in plays.items():
        families = genres.families(artist)
        if not families:
            continue
        covered += int(count)
        for family, w in families.items():
            weights[family] = weights.get(family, 0.0) + w * int(count)
    total = sum(weights.values()) or 1.0
    families = [{"family": f, "share": _r(w / total)} for f, w in sorted(weights.items(), key=lambda kv: -kv[1])]
    return {"coverage": _r(covered / len(events)) if len(events) else 0.0, "families": families}


def genres_overview(events: pd.DataFrame, genres) -> dict[str, Any]:
    overall = family_shares(events, genres)
    by_year = [{"year": int(y), "families": family_shares(g, genres)["families"][:8]}
               for y, g in events.groupby("local_year")]
    plays = events["artist_name"].value_counts()
    primary = {a: genres.primary(a) for a in plays.index}
    top_by_family: dict[str, list[dict[str, Any]]] = {}
    for artist, count in plays.items():
        family = primary[artist]
        if family and len(top_by_family.setdefault(family, [])) < 6:
            top_by_family[family].append({"name": artist, "plays": int(count)})
    styles: dict[str, int] = {}
    for artist, count in plays.items():
        style = genres.style(artist)
        if style:
            styles[style] = styles.get(style, 0) + int(count)
    top_styles = sorted(styles.items(), key=lambda kv: -kv[1])[:15]
    return {"coverage": overall["coverage"], "families": overall["families"], "by_year": by_year,
            "artists_by_family": top_by_family,
            "styles": [{"style": s, "plays": p} for s, p in top_styles]}


def rarities(events: pd.DataFrame, genres=None, limit: int = 10) -> dict[str, Any]:
    """Artists that don't fit: outside the usual genres, or heard on a single day."""
    plays = events["artist_name"].value_counts()
    days = events.groupby("artist_name")["local_date"].nunique()
    one_day = []
    for artist, count in plays.items():
        if count >= 15 and days[artist] == 1 and looks_like_artist(artist):
            date = events.loc[events["artist_name"] == artist, "local_date"].iloc[0]
            one_day.append({"name": artist, "plays": int(count), "date": _day(date)})
        if len(one_day) >= limit:
            break
    off_genre = []
    if genres is not None:
        shares = {f["family"]: f["share"] for f in family_shares(events, genres)["families"]}
        for artist, count in plays.items():
            family = genres.primary(artist)
            if count >= 10 and family and shares.get(family, 0) < 0.03:
                off_genre.append({"name": artist, "plays": int(count), "family": family, "style": genres.style(artist),
                                  "family_share": _r(shares.get(family, 0))})
            if len(off_genre) >= limit:
                break
    return {"one_day": one_day, "off_genre": off_genre}


def year_tops(events: pd.DataFrame, genres=None) -> dict[int, dict[str, Any]]:
    """Extra per-year detail merged into insights.years: top 10 artists and the main family."""
    out = {}
    for year, group in events.groupby("local_year"):
        extra = {"top_artists": _top(group["artist_name"].value_counts(), 10)}
        if genres is not None:
            families = family_shares(group, genres)["families"]
            extra["top_family"] = families[0]["family"] if families else None
        out[int(year)] = extra
    return out


def build_explore(events: pd.DataFrame, genres=None) -> dict[str, Any]:
    """explore.json v1: deeper reads kept out of insights.json v1 on purpose."""
    from datetime import datetime, timezone
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "calendar": calendar(events),
        "year_ranks": [{"year": y, **extra} for y, extra in sorted(year_tops(events, genres).items())],
        "rarities": rarities(events, genres),
        "genres": genres_overview(events, genres) if genres is not None else None,
    }

"""Release year for the albums shown on the site.

MusicBrainz first-release-date (by release group) when the catalog has one,
else the Deezer album release_date. Only resolved catalog rows are asked, one
request per second; any failure just leaves the year out.
"""

from __future__ import annotations

import time
from typing import Iterable

import pandas as pd
import requests


def _year(text) -> int | None:
    try:
        year = int(str(text)[:4])
        return year if 1900 <= year <= 2100 else None
    except (TypeError, ValueError):
        return None


def release_years(catalog: pd.DataFrame, keys: Iterable[str], user_agent: str, session=None, sleep=time.sleep) -> dict[str, int]:
    session = session or requests.Session()
    rows = catalog.set_index("album_key") if len(catalog) else pd.DataFrame()
    out: dict[str, int] = {}
    for key in keys:
        if key not in rows.index:
            continue
        row = rows.loc[key]
        try:
            if isinstance(row.get("release_group_mbid"), str) and row["release_group_mbid"]:
                r = session.get(f"https://musicbrainz.org/ws/2/release-group/{row['release_group_mbid']}",
                                params={"fmt": "json"}, headers={"User-Agent": user_agent}, timeout=15)
                year = _year(r.json().get("first-release-date")) if r.ok else None
                sleep(1.1)
            elif isinstance(row.get("album_mbid"), str) and row["album_mbid"]:
                r = session.get(f"https://musicbrainz.org/ws/2/release/{row['album_mbid']}",
                                params={"fmt": "json", "inc": "release-groups"}, headers={"User-Agent": user_agent}, timeout=15)
                body = r.json() if r.ok else {}
                year = _year((body.get("release-group") or {}).get("first-release-date") or body.get("date"))
                sleep(1.1)
            elif row.get("provider") == "deezer" and str(row.get("provider_id") or "").isdigit():
                r = session.get(f"https://api.deezer.com/album/{row['provider_id']}", timeout=15)
                year = _year(r.json().get("release_date")) if r.ok else None
                sleep(0.3)
            else:
                year = None
        except (requests.RequestException, ValueError):
            year = None
        if year:
            out[key] = year
    return out

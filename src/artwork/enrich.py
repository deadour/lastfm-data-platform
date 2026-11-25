"""Incremental album artwork catalog.

    python -m src.artwork.enrich --limit 100 --dry-run
    python -m src.artwork.enrich --limit 100
    python -m src.artwork.enrich --accept <album_key>   # confirm a needs_review row
    python -m src.artwork.enrich --reject <album_key>

Order of sources for each album (most-played first):
1. Cover Art Archive front image of the Last.fm release MBID.
2. Cover Art Archive front image of that release's release-group (MusicBrainz lookup).
3. Deezer album search, accepted only on an unambiguous normalized match;
   anything weaker is stored as ``needs_review`` and never exported.

Resolved and needs_review albums are not queried again. ``not_found`` is
retried after ``--retry-days``. The catalog stores URLs only.
"""

import argparse
from datetime import datetime, timedelta, timezone
import json
import logging
from pathlib import Path
import tempfile
from typing import Any

import pandas as pd

from .clients import ArtworkError, CoverArtArchive, Deezer, MusicBrainzReleases, https_url
from .matching import album_key, decide

LOGGER = logging.getLogger("artwork")
CATALOG_DIR = Path("data/artwork")
COLUMNS = ["album_key", "artist_name", "album_name", "album_mbid", "release_group_mbid", "scrobbles",
           "status", "provider", "provider_id", "image_url", "source_url", "match_confidence", "match_reason",
           "license_note", "checked_at", "updated_at"]
LICENSE = {
    "coverartarchive": "Cover Art Archive; rights stay with the copyright holders, shown as album identification. "
                       "Link back to the MusicBrainz release.",
    "deezer": "Deezer API image; display with attribution and a link to the Deezer album page, per Deezer's API terms.",
}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def albums_from_silver(silver: pd.DataFrame) -> pd.DataFrame:
    """One row per album key, most-played first, with the most common spelling and MBID."""
    frame = silver[["artist_name", "album_name", "album_mbid"]].copy()
    frame["album_name"] = frame["album_name"].fillna("").astype(str).str.strip()
    frame = frame[frame["album_name"] != ""]
    frame["album_mbid"] = frame["album_mbid"].fillna("").astype(str).str.strip()
    pairs = frame[["artist_name", "album_name"]].drop_duplicates()
    pairs["album_key"] = [album_key(a, b) for a, b in zip(pairs["artist_name"], pairs["album_name"])]
    frame = frame.merge(pairs, on=["artist_name", "album_name"], how="left")
    def most_common(column: str, rows: pd.DataFrame) -> pd.Series:
        # value_counts order: highest count first, ties by first appearance.
        counts = rows.groupby(["album_key", column], sort=False).size().rename("n").reset_index()
        counts = counts.sort_values("n", ascending=False, kind="stable").drop_duplicates("album_key")
        return counts.set_index("album_key")[column]

    grouped = pd.DataFrame({"artist_name": most_common("artist_name", frame),
                            "album_name": most_common("album_name", frame)})
    grouped["album_mbid"] = most_common("album_mbid", frame[frame["album_mbid"] != ""]).reindex(grouped.index).fillna("")
    grouped["scrobbles"] = frame.groupby("album_key").size()
    grouped.index.name = "album_key"
    return grouped.reset_index().sort_values(["scrobbles", "album_key"], ascending=[False, True], ignore_index=True)


def read_catalog(directory: Path = CATALOG_DIR) -> pd.DataFrame:
    """Load the catalog; rows saved before https normalization are upgraded on read."""
    path = directory / "catalog.parquet"
    if not path.exists():
        return pd.DataFrame(columns=COLUMNS)
    catalog = pd.read_parquet(path)
    catalog["image_url"] = catalog["image_url"].map(https_url)
    return catalog


def write_catalog(catalog: pd.DataFrame, directory: Path = CATALOG_DIR) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    catalog = catalog[COLUMNS].sort_values(["scrobbles", "album_key"], ascending=[False, True], ignore_index=True)
    for name, write in (("catalog.parquet", lambda p: catalog.to_parquet(p, index=False)),
                        ("catalog.json", lambda p: p.write_text(
                            catalog.to_json(orient="records", force_ascii=False, indent=1) + "\n", encoding="utf-8"))):
        with tempfile.NamedTemporaryFile(dir=directory, suffix=name, delete=False) as handle:
            staged = Path(handle.name)
        try:
            write(staged)
            staged.replace(directory / name)
        finally:
            staged.unlink(missing_ok=True)


def due(catalog: pd.DataFrame, albums: pd.DataFrame, retry_days: int, at: datetime) -> pd.DataFrame:
    """Albums never checked, or not_found older than retry_days."""
    known = catalog.set_index("album_key")
    cutoff = at - timedelta(days=retry_days)
    keep = []
    for key in albums["album_key"]:
        if key not in known.index:
            keep.append(True)
            continue
        row = known.loc[key]
        stale = pd.Timestamp(row["checked_at"]).to_pydatetime() < cutoff
        keep.append(row["status"] == "not_found" and stale)
    return albums[keep]


def resolve(album: dict[str, Any], caa: CoverArtArchive, mb: MusicBrainzReleases, deezer: Deezer) -> dict[str, Any]:
    stamp = now()
    record = {**{c: None for c in COLUMNS}, **album, "checked_at": stamp, "updated_at": stamp}
    mbid = album.get("album_mbid") or None
    record["album_mbid"] = mbid
    if mbid:
        url = caa.front("release", mbid)
        confidence, reason = 1.0, "release mbid from last.fm"
        if not url:
            record["release_group_mbid"] = mb.release_group(mbid)
            if record["release_group_mbid"]:
                url = caa.front("release-group", record["release_group_mbid"])
                confidence, reason = 0.95, "release-group of last.fm mbid"
        if url:
            return {**record, "status": "resolved", "provider": "coverartarchive", "provider_id": mbid,
                    "image_url": url, "source_url": f"https://musicbrainz.org/release/{mbid}",
                    "match_confidence": confidence, "match_reason": reason, "license_note": LICENSE["coverartarchive"]}
    candidates = deezer.search_albums(album["artist_name"], album["album_name"])
    decision = decide(album["artist_name"], album["album_name"],
                      [((c.get("artist") or {}).get("name", ""), c.get("title", "")) for c in candidates])
    record.update(status=decision.status, match_confidence=decision.confidence, match_reason=decision.reason)
    if decision.index is not None:
        chosen = candidates[decision.index]
        record.update(provider="deezer", provider_id=str(chosen.get("id")),
                      image_url=https_url(chosen.get("cover_xl") or chosen.get("cover_big")),
                      source_url=chosen.get("link"), license_note=LICENSE["deezer"])
    return record


def review(catalog: pd.DataFrame, key: str, accept: bool) -> pd.DataFrame:
    rows = catalog.index[(catalog["album_key"] == key) & (catalog["status"] == "needs_review")]
    if len(rows) != 1:
        raise ValueError(f"{key} is not a needs_review album")
    catalog.loc[rows, ["status", "match_reason", "updated_at"]] = (
        ("resolved", "accepted in manual review", now()) if accept else ("rejected", "rejected in manual review", now()))
    return catalog


def run(silver_path: Path, limit: int, retry_days: int, user_agent: str, interval: float,
        directory: Path = CATALOG_DIR, clients=None, save_every: int = 20) -> dict[str, int]:
    albums = albums_from_silver(pd.read_parquet(silver_path, columns=["artist_name", "album_name", "album_mbid"]))
    catalog = read_catalog(directory)
    todo = due(catalog, albums.head(limit), retry_days, datetime.now(timezone.utc))
    caa, mb, deezer = clients or (CoverArtArchive(user_agent, interval), MusicBrainzReleases(user_agent, interval),
                                  Deezer(user_agent))
    counts: dict[str, int] = {}
    records = {}
    try:
        for done, album in enumerate(todo.to_dict("records"), 1):
            record = resolve(album, caa, mb, deezer)
            records[record["album_key"]] = record
            counts[record["status"]] = counts.get(record["status"], 0) + 1
            if done % save_every == 0:
                catalog = merge(catalog, records)
                write_catalog(catalog, directory)
                records = {}
    except ArtworkError as exc:
        LOGGER.warning("stopping early: %s; progress so far is kept", exc)
        counts["stopped"] = 1
    finally:
        if records:
            catalog = merge(catalog, records)
        if records or not (directory / "catalog.parquet").exists():
            write_catalog(catalog, directory)
    counts["checked"] = sum(v for k, v in counts.items() if k != "stopped")
    return counts


def merge(catalog: pd.DataFrame, records: dict[str, dict]) -> pd.DataFrame:
    fresh = pd.DataFrame(list(records.values()), columns=COLUMNS)
    kept = catalog[~catalog["album_key"].isin(records)]
    return pd.concat([kept, fresh], ignore_index=True) if len(kept) else fresh


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve album covers into data/artwork/catalog.*")
    parser.add_argument("--silver", type=Path, default=Path("data/silver/scrobbles/scrobbles.parquet"))
    parser.add_argument("--limit", type=int, default=100, help="Consider only the N most-played albums")
    parser.add_argument("--retry-days", type=int, default=30, help="Retry not_found albums after this many days")
    parser.add_argument("--dry-run", action="store_true", help="List albums that would be queried; no network")
    parser.add_argument("--accept", metavar="ALBUM_KEY")
    parser.add_argument("--reject", metavar="ALBUM_KEY")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.accept or args.reject:
        write_catalog(review(read_catalog(), args.accept or args.reject, bool(args.accept)))
        return 0
    if args.dry_run:
        albums = albums_from_silver(pd.read_parquet(args.silver, columns=["artist_name", "album_name", "album_mbid"]))
        todo = due(read_catalog(), albums.head(args.limit), args.retry_days, datetime.now(timezone.utc))
        print(f"{len(todo)} of top {args.limit} albums need a lookup "
              f"({int((todo['album_mbid'] != '').sum())} with MBID, the rest via Deezer search)")
        return 0
    config = json.loads(Path("config/enrichment.json").read_text(encoding="utf-8"))
    counts = run(args.silver, args.limit, args.retry_days, config["musicbrainz_user_agent"],
                 float(config["musicbrainz_interval_seconds"]))
    print(json.dumps(counts))
    return 1 if counts.get("stopped") else 0


if __name__ == "__main__":
    raise SystemExit(main())

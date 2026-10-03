"""Build Phase 5 enriched analytical marts without mutating existing layers."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any

import pandas as pd

from src.enrichment.enrich import artist_key


TRACKING_ERAS = {"partial_tracking", "consistent_tracking"}
REQUIRED_PROFILE_COLUMNS = [
    "artist_key", "source_artist_name", "musicbrainz_artist_id", "canonical_name", "artist_type",
    "country", "area", "begin_area", "resolution_status", "resolution_method", "resolution_confidence",
]


def load_taxonomy(config_path: str | Path = "config/tag_taxonomy.json") -> dict[str, Any]:
    return json.loads(Path(config_path).read_text(encoding="utf-8"))


def classify_tag(tag: str, taxonomy: dict[str, Any]) -> tuple[str, str | None]:
    normalized = str(tag).strip().casefold()
    if normalized in set(taxonomy.get("noise", [])):
        return "noise", None
    for family, values in taxonomy.get("genre_family", {}).items():
        if normalized in set(values):
            return "genre_style", family
    if normalized in set(taxonomy.get("geography", [])):
        return "geography", None
    if normalized in set(taxonomy.get("era", [])):
        return "era", None
    if normalized in set(taxonomy.get("descriptor", [])):
        return "descriptor", None
    return "other", None


def _year_era(events: pd.DataFrame) -> pd.DataFrame:
    events = events.copy()
    events["scrobbled_at"] = pd.to_datetime(events["scrobbled_at"], utc=True)
    events["year"] = events["scrobbled_at"].dt.year.astype("int64")
    events["month"] = events["scrobbled_at"].dt.month.astype("int64")
    events["date"] = events["scrobbled_at"].dt.date
    events["weekday"] = events["scrobbled_at"].dt.weekday.astype("int64")
    events["hour"] = events["scrobbled_at"].dt.hour.astype("int64")
    boundary = pd.Timestamp("2020-01-01", tz="UTC")
    events["tracking_era"] = events["scrobbled_at"].ge(boundary).map({True: "consistent_tracking", False: "partial_tracking"})
    events["track_key"] = events["artist_name"].astype("string") + "\x1f" + events["track_name"].astype("string")
    return events


def prepare_inputs(silver_path: str | Path, artists_path: str | Path, tags_path: str | Path,
                   taxonomy_path: str | Path = "config/tag_taxonomy.json") -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    silver = _year_era(pd.read_parquet(silver_path))
    artists = pd.read_parquet(artists_path)
    tags = pd.read_parquet(tags_path)
    taxonomy = load_taxonomy(taxonomy_path)
    missing = set(REQUIRED_PROFILE_COLUMNS) - set(artists.columns)
    if missing:
        raise ValueError(f"Artist enrichment schema is missing columns: {sorted(missing)}")
    if not artists["artist_key"].is_unique:
        raise ValueError("Artist enrichment artist_key must be unique")
    silver["artist_key"] = silver["artist_name"].map(artist_key)
    artist_joined = silver.merge(artists, on="artist_key", how="left", validate="many_to_one", indicator=True)
    if (artist_joined["_merge"] != "both").any():
        raise ValueError("Artist bridge contains unmatched Silver events")
    tags = tags.copy()
    tags[["tag_category", "genre_family"]] = tags.apply(
        lambda row: pd.Series(classify_tag(row["tag_normalized"], taxonomy)), axis=1
    )
    max_tags = int(taxonomy.get("max_tags_per_artist", 5))
    tags = tags.sort_values(["artist_key", "tag_rank", "tag_normalized"])
    tags = tags[tags["tag_rank"] <= max_tags].copy()
    tags["rank_weight_raw"] = 1.0 / tags["tag_rank"].clip(lower=1)
    denominators = tags.groupby("artist_key")["rank_weight_raw"].transform("sum")
    tags["tag_weight"] = tags["rank_weight_raw"] / denominators
    return silver, artist_joined.drop(columns=["_merge"]), tags, taxonomy


def _tagged_event_keys(silver: pd.DataFrame, tags: pd.DataFrame) -> set[str]:
    return set(silver.loc[silver["artist_key"].isin(tags["artist_key"]), "scrobble_id"])


def build_artist_profile(events: pd.DataFrame, tags: pd.DataFrame) -> pd.DataFrame:
    totals = events.groupby("artist_key", as_index=False).agg(
        total_scrobbles=("scrobble_id", "size"), first_listen=("scrobbled_at", "min"),
        last_listen=("scrobbled_at", "max"), active_years=("year", "nunique"),
    )
    artist_columns = [
        "artist_key", "source_artist_name", "musicbrainz_artist_id", "canonical_name", "artist_type",
        "country", "area", "begin_area", "resolution_status", "resolution_method", "resolution_confidence",
    ]
    profile = events[artist_columns].drop_duplicates("artist_key").merge(totals, on="artist_key", validate="one_to_one")
    primary = tags.sort_values(["artist_key", "tag_rank", "tag_normalized"]).drop_duplicates("artist_key")
    primary_genre = tags[tags["tag_category"] == "genre_style"].sort_values(["artist_key", "tag_rank", "tag_normalized"]).drop_duplicates("artist_key")
    profile = profile.merge(primary[["artist_key", "tag_normalized", "tag_category"]].rename(columns={"tag_normalized": "primary_tag"}), on="artist_key", how="left")
    profile = profile.merge(primary_genre[["artist_key", "genre_family"]].rename(columns={"genre_family": "primary_genre_family"}), on="artist_key", how="left")
    tag_counts = tags.groupby("artist_key").agg(tag_count=("tag_normalized", "nunique"), tag_coverage=("tag_normalized", lambda values: True)).reset_index()
    profile = profile.merge(tag_counts, on="artist_key", how="left")
    profile["tag_count"] = profile["tag_count"].fillna(0).astype("int64")
    profile["tag_coverage"] = profile["tag_coverage"].where(profile["tag_coverage"].notna(), False).astype(bool)
    return profile.sort_values(["total_scrobbles", "source_artist_name"], ascending=[False, True]).reset_index(drop=True)


def build_genre_evolution(events: pd.DataFrame, tags: pd.DataFrame) -> pd.DataFrame:
    genre_tags = tags[tags["tag_category"] == "genre_style"].copy()
    if genre_tags.empty:
        return pd.DataFrame(columns=["year", "tracking_era", "genre_family", "weighted_scrobbles", "share_of_year", "unique_artists", "genre_tag_coverage"])
    artist_weights = genre_tags.groupby(["artist_key", "genre_family"], as_index=False)["tag_weight"].sum()
    annual = events.groupby(["artist_key", "year", "tracking_era"], as_index=False).agg(scrobbles=("scrobble_id", "size"))
    annual = annual.merge(artist_weights, on="artist_key", how="inner", validate="many_to_many")
    annual["weighted_scrobbles"] = annual["scrobbles"] * annual["tag_weight"]
    result = annual.groupby(["year", "tracking_era", "genre_family"], as_index=False).agg(
        weighted_scrobbles=("weighted_scrobbles", "sum"), unique_artists=("artist_key", "nunique")
    )
    totals = result.groupby(["year", "tracking_era"])["weighted_scrobbles"].transform("sum")
    events_totals = events.groupby(["year", "tracking_era"])["scrobble_id"].size().rename("events")
    result["share_of_year"] = result["weighted_scrobbles"] / totals
    result = result.join(events_totals, on=["year", "tracking_era"])
    result["genre_tag_coverage"] = result["weighted_scrobbles"] / result["events"]
    return result.drop(columns="events").sort_values(["year", "weighted_scrobbles", "genre_family"], ascending=[True, False, True]).reset_index(drop=True)


def _lifecycle(year: int, years: set[int], first_year: int) -> str:
    if year == first_year:
        return "new"
    previous = max((value for value in years if value < year), default=first_year)
    if previous <= year - 3:
        return "resurgent"
    if year - 1 in years and year - 2 in years:
        return "persistent"
    return "returning"


def build_artist_evolution(events: pd.DataFrame) -> pd.DataFrame:
    annual = events.groupby(["artist_key", "artist_name", "year", "tracking_era"], as_index=False).agg(
        scrobbles=("scrobble_id", "size"), first_seen=("scrobbled_at", "min"), last_seen=("scrobbled_at", "max")
    )
    annual = annual.sort_values(["year", "scrobbles", "artist_name"], ascending=[True, False, True])
    annual["rank"] = annual.groupby("year").cumcount() + 1
    totals = annual.groupby("year")["scrobbles"].transform("sum")
    annual["share_of_year"] = annual["scrobbles"] / totals
    first = annual.groupby("artist_key")["year"].min().to_dict()
    all_years = annual.groupby("artist_key")["year"].apply(set).to_dict()
    annual["years_since_first_seen"] = annual["year"] - annual["artist_key"].map(first)
    annual["lifecycle"] = [
        _lifecycle(int(year), all_years[key], int(first[key])) for year, key in zip(annual["year"], annual["artist_key"])
    ]
    return annual.sort_values(["year", "rank", "artist_name"]).reset_index(drop=True)


def build_concentration(events: pd.DataFrame) -> pd.DataFrame:
    counts = events.groupby(["year", "tracking_era", "artist_key"], as_index=False).size().rename(columns={"size": "scrobbles"})
    rows = []
    for keys, group in counts.groupby(["year", "tracking_era"]):
        ordered = group["scrobbles"].sort_values(ascending=False).to_numpy()
        total = ordered.sum()
        rows.append({"year": keys[0], "tracking_era": keys[1], "top_1_share": ordered[:1].sum() / total,
                     "top_5_share": ordered[:5].sum() / total, "top_10_share": ordered[:10].sum() / total,
                     "top_25_share": ordered[:25].sum() / total, "top_50_share": ordered[:50].sum() / total,
                     "hhi": float(((ordered / total) ** 2).sum()), "artist_count": len(ordered)})
    return pd.DataFrame(rows).sort_values(["year", "tracking_era"]).reset_index(drop=True)


def build_diversity(events: pd.DataFrame) -> pd.DataFrame:
    result = events.groupby(["year", "tracking_era"], as_index=False).agg(
        scrobbles=("scrobble_id", "size"), unique_artists=("artist_key", "nunique"), unique_tracks=("track_key", "nunique")
    )
    result["artists_per_100_scrobbles"] = result["unique_artists"] / result["scrobbles"] * 100
    result["tracks_per_100_scrobbles"] = result["unique_tracks"] / result["scrobbles"] * 100
    return result


def build_discovery_enriched(events: pd.DataFrame) -> pd.DataFrame:
    first_artist = events.groupby("artist_key")["year"].min()
    first_track = events.groupby("track_key")["year"].min()
    result = events.groupby(["year", "tracking_era"], as_index=False).agg(
        scrobbles=("scrobble_id", "size"), unique_artists=("artist_key", "nunique"), unique_tracks=("track_key", "nunique")
    )
    result["new_artists"] = result["year"].map(first_artist.value_counts()).fillna(0).astype("int64")
    result["new_tracks"] = result["year"].map(first_track.value_counts()).fillna(0).astype("int64")
    new_keys = set(first_artist[first_artist.index.isin(events.loc[events["year"].isin(first_artist.values), "artist_key"])].index)
    new_event_mask = events["artist_key"].map(first_artist).eq(events["year"])
    result["new_artist_scrobbles"] = events.assign(_new=new_event_mask).groupby(["year", "tracking_era"])["_new"].sum().reindex(pd.MultiIndex.from_frame(result[["year", "tracking_era"]]), fill_value=0).to_numpy()
    result["new_artist_share"] = result["new_artist_scrobbles"] / result["scrobbles"]
    return result


def build_geography(events: pd.DataFrame) -> pd.DataFrame:
    base = events.copy()
    base["country"] = base["country"].fillna("unknown")
    result = base.groupby(["year", "tracking_era", "country"], as_index=False).agg(
        scrobbles=("scrobble_id", "size"), unique_artists=("artist_key", "nunique")
    )
    totals = result.groupby(["year", "tracking_era"])["scrobbles"].transform("sum")
    result["share_of_year"] = result["scrobbles"] / totals
    result["country_known"] = result["country"] != "unknown"
    return result.sort_values(["year", "scrobbles", "country"], ascending=[True, False, True]).reset_index(drop=True)


def build_time_patterns(events: pd.DataFrame) -> pd.DataFrame:
    return events.groupby(["year", "month", "tracking_era", "weekday", "hour"], as_index=False).agg(
        scrobbles=("scrobble_id", "size"), unique_artists=("artist_key", "nunique")
    ).sort_values(["year", "month", "weekday", "hour"]).reset_index(drop=True)


def build_era_comparison(events: pd.DataFrame, current_year: int | None = None) -> pd.DataFrame:
    yearly = events.groupby(["year", "tracking_era"], as_index=False).agg(
        scrobbles=("scrobble_id", "size"), active_days=("date", "nunique"), unique_artists=("artist_key", "nunique"), unique_tracks=("track_key", "nunique")
    )
    yearly["scrobbles_per_active_day"] = yearly["scrobbles"] / yearly["active_days"]
    yearly = yearly.sort_values("year")
    yearly["year_over_year_scrobble_change_pct"] = yearly["scrobbles"].pct_change() * 100
    max_year = int(events["year"].max())
    current_year = current_year or datetime.now(timezone.utc).year
    yearly["partial_calendar_year"] = yearly["year"].eq(max_year) & yearly["year"].eq(current_year)
    yearly["comparison_note"] = yearly["partial_calendar_year"].map({True: "incomplete current calendar year", False: "recorded calendar year"})
    return yearly.reset_index(drop=True)


def build_insights(marts: dict[str, pd.DataFrame], quality: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    genre = marts["genre_evolution"]
    concentration = marts["concentration"]
    diversity = marts["diversity"]
    top_genres = genre.sort_values("weighted_scrobbles", ascending=False).head(5)[["year", "genre_family", "share_of_year"]].to_dict("records")
    return {"generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "quality": quality, "profile": profile,
            "findings": {"top_genre_years": top_genres,
                         "highest_concentration": concentration.sort_values("top_1_share", ascending=False).head(3).to_dict("records"),
                         "highest_artist_diversity": diversity.sort_values("artists_per_100_scrobbles", ascending=False).head(3).to_dict("records")}}


def build_enriched(silver_path: str | Path = "data/silver/scrobbles/scrobbles.parquet",
                   artists_path: str | Path = "data/enrichment/normalized/artists.parquet",
                   tags_path: str | Path = "data/enrichment/normalized/artist_tags.parquet",
                   output_root: str | Path = "data/gold_enriched",
                   taxonomy_path: str | Path = "config/tag_taxonomy.json") -> dict[str, Any]:
    silver, events, tags, taxonomy = prepare_inputs(silver_path, artists_path, tags_path, taxonomy_path)
    marts = {
        "artist_profile": build_artist_profile(events, tags),
        "genre_evolution": build_genre_evolution(events, tags),
        "artist_evolution": build_artist_evolution(events),
        "concentration": build_concentration(events),
        "diversity": build_diversity(events),
        "discovery_enriched": build_discovery_enriched(events),
        "geography_evolution": build_geography(events),
        "time_patterns": build_time_patterns(events),
        "era_comparison": build_era_comparison(events),
    }
    tagged_keys = _tagged_event_keys(silver, tags)
    country_known = events["country"].notna()
    genre_events = set(events.loc[events["artist_key"].isin(tags.loc[tags["tag_category"] == "genre_style", "artist_key"]), "scrobble_id"])
    quality = {
        "silver_events_before_join": len(silver), "artist_bridge_events_after_join": len(events),
        "matched_events": len(events), "unmatched_events": 0, "tag_association_rows": len(events.merge(tags[["artist_key", "tag_normalized"]], on="artist_key", how="inner")),
        "tagged_event_coverage_pct": round(len(tagged_keys) / len(silver) * 100, 3),
        "genre_family_event_coverage_pct": round(len(genre_events) / len(silver) * 100, 3),
        "geographic_event_coverage_pct": round(country_known.sum() / len(events) * 100, 3),
        "silver_event_reconciliation": len(silver) == len(events), "artist_join_cardinality": "many_to_one",
        "tag_join_cardinality": "one_to_many_association_not_fact_join",
    }
    profile = {"events_analyzed": len(silver), "artists_enriched": len(events["artist_key"].unique()), "years_analyzed": sorted(int(value) for value in events["year"].unique()),
               "partial_tracking_events": int((events["tracking_era"] == "partial_tracking").sum()), "consistent_tracking_events": int((events["tracking_era"] == "consistent_tracking").sum()),
               "partial_calendar_year": int(events["year"].max()) == datetime.now(timezone.utc).year}
    metadata = {"generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "schema_version": 1, "source_silver_rows": len(silver),
                "source_enrichment_artists": len(pd.read_parquet(artists_path)), "source_enrichment_tags": len(pd.read_parquet(tags_path)),
                "taxonomy": {"max_tags_per_artist": taxonomy["max_tags_per_artist"], "weighting": taxonomy["weighting"]},
                "quality": quality, "profile": profile, "marts": {name: {"rows": len(frame)} for name, frame in marts.items()}}
    metadata["insights"] = build_insights(marts, quality, profile)["findings"]
    output_root = Path(output_root)
    output_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".gold-enriched-", dir=output_root.parent))
    try:
        for name, frame in marts.items():
            path = staging / f"{name}.parquet"
            frame.to_parquet(path, engine="pyarrow", index=False)
            pd.read_parquet(path, engine="pyarrow")
        (staging / "_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
        (staging / "insights.json").write_text(json.dumps(build_insights(marts, quality, profile), ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
        output_root.mkdir(parents=True, exist_ok=True)
        for path in staging.iterdir():
            os.replace(path, output_root / path.name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return {"marts": {name: len(frame) for name, frame in marts.items()}, "quality": quality, "profile": profile}

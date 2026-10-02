"""Build deterministic Gold listening marts from Silver scrobbles."""

from datetime import date, timedelta
import json
import logging
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any

import pandas as pd


LOGGER = logging.getLogger(__name__)
TRACKING_ERAS = {"partial_tracking", "consistent_tracking"}


def load_tracking_config(config_path: str | Path = "config/analytics.json") -> dict[str, Any]:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    boundary = pd.Timestamp(config["consistent_tracking_from"], tz="UTC")
    if boundary.tz is None:
        boundary = boundary.tz_localize("UTC")
    config["boundary"] = boundary
    return config


def prepare_events(silver: pd.DataFrame, boundary: pd.Timestamp) -> pd.DataFrame:
    events = silver.copy()
    events["scrobbled_at"] = pd.to_datetime(events["scrobbled_at"], utc=True)
    events["date"] = events["scrobbled_at"].dt.date
    events["year"] = events["scrobbled_at"].dt.year
    events["month"] = events["scrobbled_at"].dt.month
    events["hour"] = events["scrobbled_at"].dt.hour
    events["weekday"] = events["scrobbled_at"].dt.weekday
    events["tracking_era"] = events["scrobbled_at"].ge(boundary).map(
        {True: "consistent_tracking", False: "partial_tracking"}
    )
    return events


def _unique_track_key(events: pd.DataFrame) -> pd.Series:
    return events["artist_name"].astype("string") + "\x1f" + events["track_name"].astype("string")


def _top_artist_table(events: pd.DataFrame) -> pd.DataFrame:
    counts = events.groupby(["year", "artist_name"], dropna=False).size().reset_index(name="scrobble_count")
    return counts.sort_values(["year", "scrobble_count", "artist_name"], ascending=[True, False, True])


def build_daily(events: pd.DataFrame) -> pd.DataFrame:
    daily = events.groupby(["date", "tracking_era"], as_index=False).agg(
        scrobble_count=("scrobble_id", "size"),
        unique_artists=("artist_name", "nunique"),
        unique_tracks=("track_key", "nunique"),
    )
    daily["year"] = pd.to_datetime(daily["date"]).dt.year
    daily["month"] = pd.to_datetime(daily["date"]).dt.month
    daily["weekday"] = pd.to_datetime(daily["date"]).dt.weekday
    return daily[["date", "year", "month", "weekday", "tracking_era", "scrobble_count", "unique_artists", "unique_tracks"]].sort_values("date").reset_index(drop=True)


def build_monthly(events: pd.DataFrame) -> pd.DataFrame:
    monthly = events.groupby(["year", "month", "tracking_era"], as_index=False).agg(
        scrobble_count=("scrobble_id", "size"), active_days=("date", "nunique"),
        unique_artists=("artist_name", "nunique"), unique_tracks=("track_key", "nunique"),
    )
    monthly["year_month"] = monthly["year"].astype(str) + "-" + monthly["month"].astype(str).str.zfill(2)
    monthly["scrobbles_per_active_day"] = monthly["scrobble_count"] / monthly["active_days"]
    return monthly[["year", "month", "year_month", "tracking_era", "scrobble_count", "active_days",
                    "unique_artists", "unique_tracks", "scrobbles_per_active_day"]].sort_values(["year", "month"]).reset_index(drop=True)


def _concentration(yearly: pd.DataFrame, artist_counts: pd.DataFrame) -> pd.DataFrame:
    totals = yearly.set_index("year")["scrobble_count"]
    rows = []
    for year, group in artist_counts.groupby("year"):
        ordered = group.sort_values(["scrobble_count", "artist_name"], ascending=[False, True])
        total = totals.loc[year]
        rows.append({
            "year": year,
            "top_1_artist_share": ordered.head(1)["scrobble_count"].sum() / total,
            "top_5_artist_share": ordered.head(5)["scrobble_count"].sum() / total,
            "top_10_artist_share": ordered.head(10)["scrobble_count"].sum() / total,
        })
    return pd.DataFrame(rows)


def build_yearly(events: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    yearly = events.groupby(["year", "tracking_era"], as_index=False).agg(
        scrobble_count=("scrobble_id", "size"), active_days=("date", "nunique"),
        unique_artists=("artist_name", "nunique"), unique_tracks=("track_key", "nunique"),
    )
    yearly["average_scrobbles_per_active_day"] = yearly["scrobble_count"] / yearly["active_days"]
    artist_counts = _top_artist_table(events)
    ranks = artist_counts.copy()
    ranks["rank_in_year"] = ranks.groupby("year").cumcount() + 1
    top = ranks[ranks["rank_in_year"] == 1].rename(columns={"artist_name": "top_artist", "scrobble_count": "top_artist_scrobbles"})
    yearly = yearly.merge(top[["year", "top_artist", "top_artist_scrobbles"]], on="year", how="left")
    artist_first = events.groupby("artist_name")["year"].min()
    track_first = events.groupby("track_key")["year"].min()
    yearly["new_artists"] = yearly["year"].map(artist_first.value_counts()).fillna(0).astype("int64")
    yearly["new_tracks"] = yearly["year"].map(track_first.value_counts()).fillna(0).astype("int64")
    yearly = yearly.merge(_concentration(yearly, artist_counts), on="year", how="left")
    yearly["scrobbles_per_unique_artist"] = yearly["scrobble_count"] / yearly["unique_artists"]
    columns = ["year", "tracking_era", "scrobble_count", "active_days", "unique_artists", "unique_tracks",
               "average_scrobbles_per_active_day", "new_artists", "new_tracks", "top_artist", "top_artist_scrobbles",
               "top_1_artist_share", "top_5_artist_share", "top_10_artist_share", "scrobbles_per_unique_artist"]
    return yearly[columns].sort_values("year").reset_index(drop=True), artist_counts


def build_artist_stats(events: pd.DataFrame, artist_counts: pd.DataFrame) -> pd.DataFrame:
    annual = events.groupby(["artist_name", "year", "tracking_era"], as_index=False).agg(
        scrobble_count=("scrobble_id", "size"), unique_tracks=("track_key", "nunique"), active_days=("date", "nunique"),
        first_scrobble=("scrobbled_at", "min"), last_scrobble=("scrobbled_at", "max"),
    )
    annual["rank_in_year"] = annual.sort_values(["year", "scrobble_count", "artist_name"], ascending=[True, False, True]).groupby("year").cumcount() + 1
    totals = events.groupby("artist_name").agg(
        total_scrobbles=("scrobble_id", "size"), first_seen=("scrobbled_at", "min"), last_seen=("scrobbled_at", "max"),
        active_years=("year", "nunique"),
    ).reset_index()
    persistence = annual.groupby("artist_name").agg(
        years_in_top_10=("rank_in_year", lambda ranks: int((ranks <= 10).sum())),
        years_in_top_50=("rank_in_year", lambda ranks: int((ranks <= 50).sum())),
    ).reset_index()
    totals = totals.merge(persistence, on="artist_name", how="left")
    annual = annual.merge(totals, on="artist_name", how="left")
    year_totals = annual.groupby("year")["scrobble_count"].transform("sum")
    annual["share_of_year"] = annual["scrobble_count"] / year_totals
    return annual.sort_values(["year", "rank_in_year", "artist_name"]).reset_index(drop=True)


def build_track_stats(events: pd.DataFrame) -> pd.DataFrame:
    tracks = events.groupby(["artist_name", "track_name"], as_index=False).agg(
        total_scrobbles=("scrobble_id", "size"), first_seen=("scrobbled_at", "min"), last_seen=("scrobbled_at", "max"),
        active_days=("date", "nunique"), active_years=("year", "nunique"),
    )
    annual = events.groupby(["artist_name", "track_name", "year"], as_index=False).size().rename(columns={"size": "count"})
    annual = annual.sort_values(["artist_name", "track_name", "count", "year"], ascending=[True, True, False, True])
    peak = annual.drop_duplicates(["artist_name", "track_name"]).rename(columns={"year": "peak_year"})
    return tracks.merge(peak[["artist_name", "track_name", "peak_year"]], on=["artist_name", "track_name"], how="left").sort_values(["total_scrobbles", "artist_name", "track_name"], ascending=[False, True, True]).reset_index(drop=True)


def build_discovery(events: pd.DataFrame) -> pd.DataFrame:
    artist_first = events.groupby("artist_name")["year"].min()
    track_first = events.groupby("track_key")["year"].min()
    yearly = events.groupby(["year", "tracking_era"], as_index=False).agg(
        total_unique_artists=("artist_name", "nunique"), total_unique_tracks=("track_key", "nunique"),
    )
    yearly["newly_observed_artists"] = yearly["year"].map(artist_first.value_counts()).fillna(0).astype("int64")
    yearly["newly_observed_tracks"] = yearly["year"].map(track_first.value_counts()).fillna(0).astype("int64")
    artists_by_year = events.groupby("year")["artist_name"].unique()
    yearly["returning_artists"] = [sum(1 for artist in artists_by_year.loc[row.year] if artist_first[artist] < row.year) for row in yearly.itertuples()]
    yearly["artist_discovery_rate"] = yearly["newly_observed_artists"] / yearly["total_unique_artists"]
    return yearly.sort_values("year").reset_index(drop=True)


def build_patterns(events: pd.DataFrame) -> pd.DataFrame:
    patterns = events.groupby(["tracking_era", "weekday", "hour"], as_index=False).agg(
        scrobble_count=("scrobble_id", "size"), unique_artists=("artist_name", "nunique"),
    )
    era_totals = patterns.groupby("tracking_era")["scrobble_count"].transform("sum")
    patterns["share_of_era_scrobbles"] = patterns["scrobble_count"] / era_totals
    return patterns.sort_values(["tracking_era", "weekday", "hour"]).reset_index(drop=True)


def build_streaks(events: pd.DataFrame, boundary: pd.Timestamp) -> pd.DataFrame:
    dates = sorted(set(events.loc[events["scrobbled_at"] >= boundary, "date"]))
    streaks: list[dict[str, Any]] = []
    if not dates:
        return pd.DataFrame(columns=["start_date", "end_date", "days", "tracking_era"])
    start = previous = dates[0]
    for current in dates[1:] + [None]:
        if current is not None and current == previous + timedelta(days=1):
            previous = current
            continue
        streaks.append({"start_date": start, "end_date": previous, "days": (previous - start).days + 1,
                        "tracking_era": "consistent_tracking"})
        if current is not None:
            start = previous = current
    return pd.DataFrame(streaks).sort_values(["start_date", "end_date"]).reset_index(drop=True)


def build_marts(silver: pd.DataFrame, boundary: pd.Timestamp) -> tuple[dict[str, pd.DataFrame], dict[str, Any]]:
    events = prepare_events(silver, boundary)
    events["track_key"] = _unique_track_key(events)
    daily = build_daily(events)
    monthly = build_monthly(events)
    yearly, artist_counts = build_yearly(events)
    artist_stats = build_artist_stats(events, artist_counts)
    track_stats = build_track_stats(events)
    discovery = build_discovery(events)
    patterns = build_patterns(events)
    streaks = build_streaks(events, boundary)
    marts = {"listening_daily": daily, "listening_monthly": monthly, "listening_yearly": yearly,
             "artist_stats": artist_stats, "track_stats": track_stats, "discovery": discovery,
             "listening_patterns": patterns, "streaks": streaks}
    profile = {
        "silver_source_rows": len(silver),
        "partial_tracking_rows": int((events["tracking_era"] == "partial_tracking").sum()),
        "consistent_tracking_rows": int((events["tracking_era"] == "consistent_tracking").sum()),
        "longest_recorded_streak_since_2020": int(streaks["days"].max()) if not streaks.empty else 0,
        "latest_recorded_streak_since_2020": int(streaks.iloc[-1]["days"]) if not streaks.empty else 0,
        "top_recorded_artist": str(artist_stats.sort_values(["total_scrobbles", "artist_name"], ascending=[False, True]).iloc[0]["artist_name"]) if not artist_stats.empty else None,
        "top_recorded_track": str(track_stats.iloc[0]["track_name"]) if not track_stats.empty else None,
    }
    return marts, profile


def validate_marts(marts: dict[str, pd.DataFrame], silver_rows: int) -> dict[str, Any]:
    daily = marts["listening_daily"]
    yearly = marts["listening_yearly"]
    if int(daily["scrobble_count"].sum()) != silver_rows or int(yearly["scrobble_count"].sum()) != silver_rows:
        raise ValueError("Gold conservation check failed")
    for name, dataframe in marts.items():
        if any(column in dataframe for column in ["scrobble_count", "total_scrobbles", "active_days", "unique_artists", "unique_tracks"]):
            for column in ["scrobble_count", "total_scrobbles", "active_days", "unique_artists", "unique_tracks"]:
                if column in dataframe and (dataframe[column] < 0).any():
                    raise ValueError(f"Gold contains negative values in {name}.{column}")
        if "tracking_era" in dataframe and not set(dataframe["tracking_era"].dropna()).issubset(TRACKING_ERAS):
            raise ValueError(f"Unknown tracking era in {name}")
    yearly_shares = yearly[["top_1_artist_share", "top_5_artist_share", "top_10_artist_share"]]
    if ((yearly_shares < 0) | (yearly_shares > 1)).any().any():
        raise ValueError("Gold artist shares are outside [0, 1]")
    if not daily["month"].between(1, 12).all() or not daily["weekday"].between(0, 6).all():
        raise ValueError("Gold daily calendar fields are invalid")
    return {"daily_count": len(daily), "monthly_count": len(marts["listening_monthly"]),
            "yearly_count": len(yearly), "silver_conservation": True}


def _write_staged_parquet(dataframe: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dataframe.to_parquet(path, engine="pyarrow", index=False)
    pd.read_parquet(path, engine="pyarrow")


def build_gold(silver_path: str | Path = "data/silver/scrobbles/scrobbles.parquet",
               gold_root: str | Path = "data/gold", config_path: str | Path = "config/analytics.json") -> dict[str, Any]:
    silver = pd.read_parquet(silver_path, engine="pyarrow")
    config = load_tracking_config(config_path)
    marts, profile = build_marts(silver, config["boundary"])
    quality = validate_marts(marts, len(silver))
    gold_root = Path(gold_root)
    staging = Path(tempfile.mkdtemp(prefix=".gold-build-", dir=gold_root.parent))
    try:
        output_map = {name: ("listening_patterns" if name == "streaks" else name, "streaks.parquet" if name == "streaks" else f"{name}.parquet") for name in marts}
        for name, dataframe in marts.items():
            directory, filename = output_map[name]
            _write_staged_parquet(dataframe, staging / directory / filename)
        silver_metadata_path = Path(silver_path).parent / "_metadata.json"
        silver_updated_at = None
        if silver_metadata_path.exists():
            silver_updated_at = json.loads(silver_metadata_path.read_text(encoding="utf-8")).get("last_transformed_at")
        metadata = {
            "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
            "source_silver_rows": len(silver),
            "source_silver_updated_at": silver_updated_at,
            "tracking_boundary": config["consistent_tracking_from"],
            "tracking_boundary_note": config["tracking_note"],
            "schema_version": 1,
            "quality": quality,
            "profile": profile,
            "marts": {"listening_patterns": {"rows": len(marts["listening_patterns"]), "streak_rows": len(marts["streaks"])},
                      **{name: {"rows": len(dataframe)} for name, dataframe in marts.items() if name not in {"listening_patterns", "streaks"}}},
        }
        (staging / "_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for staged_path in staging.rglob("*"):
            if staged_path.is_file():
                relative = staged_path.relative_to(staging)
                target = gold_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staged_path, target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return {"marts": {name: len(dataframe) for name, dataframe in marts.items()}, "profile": profile, "quality": quality}

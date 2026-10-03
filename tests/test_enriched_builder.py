import json

import pandas as pd

from src.analytics.enriched_builder import (
    build_concentration,
    build_diversity,
    build_genre_evolution,
    build_era_comparison,
    classify_tag,
    prepare_inputs,
)
from src.enrichment.enrich import artist_key


def _inputs(tmp_path):
    silver = pd.DataFrame({
        "scrobble_id": ["e1", "e2", "e3", "e4"],
        "artist_name": ["Artist A", "Artist A", "Artist B", "Artist B"],
        "track_name": ["One", "Two", "One", "Two"],
        "scrobbled_at": pd.to_datetime(["2020-01-01", "2020-01-02", "2021-01-01", "2021-01-02"], utc=True),
    })
    silver_path = tmp_path / "silver.parquet"
    silver.to_parquet(silver_path)
    artists = pd.DataFrame({
        "artist_key": [artist_key("Artist A"), artist_key("Artist B")],
        "source_artist_name": ["Artist A", "Artist B"], "musicbrainz_artist_id": [None, None],
        "canonical_name": [None, None], "artist_type": ["Person", "Group"], "country": ["AR", None],
        "area": [None, None], "begin_area": [None, None], "resolution_status": ["resolved", "not_found"],
        "resolution_method": ["existing_mbid", "search_match"], "resolution_confidence": ["high", None],
    })
    artists_path = tmp_path / "artists.parquet"
    artists.to_parquet(artists_path)
    tags = pd.DataFrame({
        "artist_key": [artist_key("Artist A"), artist_key("Artist A"), artist_key("Artist B")],
        "tag": ["Rock", "female vocalists", "pop"], "tag_normalized": ["rock", "female vocalists", "pop"],
        "tag_count": [100, 50, 100], "tag_rank": [1, 2, 1], "source": ["lastfm"] * 3,
        "retrieved_at": ["2026-01-01Z"] * 3,
    })
    tags_path = tmp_path / "tags.parquet"
    tags.to_parquet(tags_path)
    taxonomy_path = tmp_path / "taxonomy.json"
    taxonomy_path.write_text(json.dumps({"max_tags_per_artist": 5, "weighting": "inverse_rank_normalized",
                                         "noise": [], "genre_family": {"rock": ["rock"], "pop": ["pop"]},
                                         "geography": [], "era": [], "descriptor": ["female vocalists"]}), encoding="utf-8")
    return silver_path, artists_path, tags_path, taxonomy_path


def test_taxonomy_is_explicit_and_noise_is_not_genre():
    taxonomy = {"noise": ["all"], "genre_family": {"rock": ["rock"]}, "geography": [], "era": [], "descriptor": []}
    assert classify_tag("rock", taxonomy) == ("genre_style", "rock")
    assert classify_tag("all", taxonomy) == ("noise", None)
    assert classify_tag("unmapped tag", taxonomy) == ("other", None)


def test_prepare_inputs_preserves_event_cardinality_and_normalizes_tag_weights(tmp_path):
    paths = _inputs(tmp_path)
    silver, events, tags, _ = prepare_inputs(*paths)
    assert len(silver) == len(events) == 4
    assert not events.artist_key.is_unique
    assert round(tags.groupby("artist_key").tag_weight.sum().min(), 8) == 1.0
    assert round(tags.groupby("artist_key").tag_weight.sum().max(), 8) == 1.0


def test_genre_contributions_and_shares_are_bounded(tmp_path):
    silver, events, tags, _ = prepare_inputs(*_inputs(tmp_path))
    genre = build_genre_evolution(events, tags)
    assert len(genre) > 0
    assert genre["weighted_scrobbles"].ge(0).all()
    assert genre["share_of_year"].between(0, 1).all()
    assert genre.groupby(["year", "tracking_era"])["share_of_year"].sum().round(8).eq(1).all()


def test_concentration_and_diversity_use_event_grain(tmp_path):
    _, events, _, _ = prepare_inputs(*_inputs(tmp_path))
    concentration = build_concentration(events)
    diversity = build_diversity(events)
    assert concentration["top_1_share"].between(0, 1).all()
    assert concentration["top_50_share"].between(0, 1).all()
    assert diversity["scrobbles"].sum() == len(events)


def test_current_year_is_explicitly_partial(tmp_path):
    _, events, _, _ = prepare_inputs(*_inputs(tmp_path))
    comparison = build_era_comparison(events, current_year=2021)
    assert comparison.iloc[-1]["partial_calendar_year"]

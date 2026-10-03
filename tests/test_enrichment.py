import json

import pandas as pd

from src.enrichment.artist_resolver import resolve_candidates
from src.enrichment.cache import EnrichmentCache
from src.enrichment.enrich import enrich_artists
from src.enrichment.musicbrainz_client import MusicBrainzClient


class FakeResponse:
    status_code = 200

    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        return None

    def json(self):
        return self.body


class FakeSession:
    def __init__(self):
        self.headers = {}
        self.responses = []

    def get(self, endpoint, params, timeout):
        return self.responses.pop(0)


def test_cache_roundtrip_and_safe_identity(tmp_path):
    cache = EnrichmentCache(tmp_path)
    cache.store("musicbrainz", "artist", "mbid:public-id", "success", {"id": "public-id"})
    cached = cache.load("musicbrainz", "artist", "mbid:public-id")
    assert cached["response"]["id"] == "public-id"
    assert "api_key" not in cached["request_identity"]


def test_resolver_keeps_multiple_exact_candidates_ambiguous():
    candidates = [{"id": "one", "name": "Same Name"}, {"id": "two", "name": "Same Name"}]
    resolution = resolve_candidates("Same Name", candidates)
    assert resolution.status == "ambiguous"
    assert len(resolution.candidates) == 2


def test_musicbrainz_client_sets_user_agent_and_waits_between_calls():
    session = FakeSession()
    session.responses = [FakeResponse({"id": "one"}), FakeResponse({"id": "two"})]
    sleeps = []
    clock = iter([0.0, 0.0, 0.1, 0.1])
    client = MusicBrainzClient("lastfm-data-platform/test", interval_seconds=1, session=session,
                               sleep=sleeps.append, monotonic=lambda: next(clock))
    client.get_artist("one")
    client.get_artist("two")
    assert session.headers["User-Agent"] == "lastfm-data-platform/test"
    assert sleeps == [0.9]


def test_enrichment_reuses_normalized_and_cache_state(tmp_path, monkeypatch):
    silver = pd.DataFrame({
        "artist_name": ["Fictional Artist"], "artist_mbid": [None], "scrobble_id": ["one"],
        "scrobbled_at": pd.to_datetime(["2020-01-01T00:00:00Z"], utc=True),
    })
    silver_path = tmp_path / "silver.parquet"
    silver.to_parquet(silver_path, index=False)
    config_path = tmp_path / "enrichment.json"
    config_path.write_text(json.dumps({"musicbrainz_user_agent": "test", "musicbrainz_interval_seconds": 0,
                                       "lastfm_interval_seconds": 0, "lastfm_artist_tag_limit": 20}), encoding="utf-8")
    calls = {"mb": 0, "tags": 0}

    class FakeMB:
        def __init__(self, *args, **kwargs):
            pass

        def search_artists(self, name):
            calls["mb"] += 1
            return [{"id": "public-id", "name": name, "sort-name": name, "score": 100}]

    class FakeTags:
        def __init__(self, *args, **kwargs):
            pass

        def get_top_tags(self, artist):
            calls["tags"] += 1
            return {"toptags": {"tag": [{"name": "Rock", "count": "5"}]}}

    monkeypatch.setattr("src.enrichment.enrich.MusicBrainzClient", FakeMB)
    monkeypatch.setattr("src.enrichment.enrich.LastFMArtistTagsClient", FakeTags)
    monkeypatch.setenv("LASTFM_API_KEY", "sentinel")

    enrich_artists(limit=1, silver_path=silver_path, raw_root=tmp_path / "raw", normalized_root=tmp_path / "normalized", config_path=config_path)
    first_calls = calls.copy()
    enrich_artists(limit=1, silver_path=silver_path, raw_root=tmp_path / "raw", normalized_root=tmp_path / "normalized", config_path=config_path)

    assert calls == first_calls
    assert (tmp_path / "normalized" / "artists.parquet").exists()
    assert (tmp_path / "normalized" / "artist_tags.parquet").exists()
    tags = pd.read_parquet(tmp_path / "normalized" / "artist_tags.parquet")
    assert not tags.duplicated(["artist_key", "tag_normalized"]).any()

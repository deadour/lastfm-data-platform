import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from azure.core.exceptions import ResourceModifiedError
import pandas as pd
import pytest

from src.analytics.gold_builder import build_gold
from src.artwork import enrich
from src.artwork import artist_photos
from src.enrichment import cloud_genres
from src.jobs import export_stats as job
from src.storage import checkpoint
from src.transformation.transform_scrobbles import transform
from tests.test_cloud_run import FakeLake
from tests.test_silver_pipeline import make_run


@pytest.fixture
def lake(tmp_path):
    source = tmp_path / "source"
    make_run(source / "bronze", "fictional-run", 1700000000)
    transform(full=True, bronze_root=source / "bronze", silver_root=source / "silver")
    build_gold(silver_path=source / "silver/scrobbles/scrobbles.parquet", gold_root=source / "gold")
    store = FakeLake()
    snapshots = {}
    for layer, root, names, prefix in (
        ("silver", source / "silver/scrobbles", job.SILVER_FILES, "silver/scrobbles/snapshot=20261125T180000Z"),
        ("gold", source / "gold", job.GOLD_FILES, "gold/snapshot=20261125T180001Z"),
    ):
        files = {}
        for name in names:
            data = (root / name).read_bytes()
            store._put(f"{prefix}/{name}", data)
            files[name] = hashlib.sha256(data).hexdigest()
        snapshots[layer] = {"prefix": prefix, "files": files}
    store._put(checkpoint.CHECKPOINT_BLOB, json.dumps({"schema_version": 1, "sequence": 7, "snapshots": snapshots}).encode())
    return store


class FakeDeezer:
    """Offline stand-in: tests never reach the network."""

    def __init__(self, results=None):
        self.calls = []
        self.results = results if results is not None else [{
            "id": 1, "name": "Fictional Artist", "link": "https://www.deezer.com/artist/1",
            "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/abc123/1000x1000-000000-80-0-0.jpg"}]

    def search_artists(self, name, limit=10):
        self.calls.append(name)
        return self.results


class FakeTags:
    """Offline Last.fm tags: tests never reach the network even if a key is in the env."""

    def __init__(self, tags=("rock argentino", "rock")):
        self.calls = []
        self.tags = tags

    def get_top_tags(self, artist, mbid=None):
        self.calls.append((artist, mbid))
        return {"toptags": {"tag": [{"name": t, "count": 100 - i} for i, t in enumerate(self.tags)]}}


def export(lake, tmp_path, **kwargs):
    out = tmp_path / "public/stats.json"
    kwargs.setdefault("deezer", FakeDeezer())
    kwargs.setdefault("tags_client", FakeTags())
    summary = job.run_export(lake, tmp_path / "work", out, **kwargs)
    return summary, json.loads(out.read_text(encoding="utf-8"))


def test_exports_real_gold_without_local_inputs_or_remote_writes(lake, tmp_path):
    before = dict(lake.blobs)
    summary, document = export(lake, tmp_path, refresh_artwork=False)
    assert summary["scrobbles"] == 1
    assert document["source"] == "gold"
    assert document["totals"]["scrobbles"] == 1
    assert len(document["rhythm"]) == 168
    assert lake.blobs == before
    public = tmp_path / "public"
    assert sorted(p.name for p in public.iterdir()) == ["artists", "explore.json", "insights.json", "recent.json", "stats.json"]
    assert [p.name for p in (public / "artists").iterdir()] == ["fictional-artist.json"]
    for extra in (public / "insights.json", public / "recent.json", public / "explore.json", public / "artists/fictional-artist.json"):
        for private in ("fictional-user", "scrobble_id", "snapshot=", "watermark", str(tmp_path), "blob.core.windows.net"):
            assert private not in extra.read_text(encoding="utf-8")
    text = json.dumps(document)
    for private in ("fictional-user", "scrobble_id", "snapshot=", "watermark", str(tmp_path), "blob.core.windows.net"):
        assert private not in text


def resolved_catalog(silver, limit, retry, ua, interval, directory):
    albums = enrich.albums_from_silver(pd.read_parquet(silver))
    row = {**{name: None for name in enrich.COLUMNS}, **albums.iloc[0].to_dict(),
           "status": "resolved", "provider": "coverartarchive", "checked_at": enrich.now(),
           "image_url": "https://coverartarchive.org/front.jpg", "source_url": "https://musicbrainz.org/release/example"}
    enrich.write_catalog(pd.DataFrame([row]), directory)
    return {"checked": 1}


def test_only_artwork_catalog_is_updated_and_checkpoint_stays_identical(lake, tmp_path):
    before, etags = dict(lake.blobs), dict(lake.etags)
    _, document = export(lake, tmp_path, enrich_fn=resolved_catalog)
    assert document["top_albums"][0]["cover"]["url"].startswith("https://")
    assert set(lake.blobs) - set(before) == {job.CATALOG_BLOB, artist_photos.CATALOG_BLOB, cloud_genres.CATALOG_BLOB}
    assert all(lake.blobs[key] == value and lake.etags[key] == etags[key] for key, value in before.items())
    assert not lake.lease_held


def test_cached_catalog_is_used_without_provider_calls(lake, tmp_path):
    export(lake, tmp_path / "first", enrich_fn=resolved_catalog)
    before = dict(lake.blobs)
    _, document = export(lake, tmp_path / "second", refresh_artwork=False)
    assert document["top_albums"][0]["cover"]["provider"] == "coverartarchive"
    assert lake.blobs == before


def test_provider_failure_keeps_confirmed_covers_and_fresh_stats(lake, tmp_path):
    def partial(*args, **kwargs):
        return {**resolved_catalog(*args, **kwargs), "stopped": 1}
    _, document = export(lake, tmp_path, enrich_fn=partial)
    assert document["totals"]["scrobbles"] == 1
    assert document["top_albums"][0]["cover"] is not None


def test_concurrent_catalog_update_prevents_publication(lake, tmp_path):
    def conflict(*args, **kwargs):
        raise ResourceModifiedError("concurrent review")
    lake.write_bytes_conditional = conflict
    with pytest.raises(ResourceModifiedError):
        export(lake, tmp_path, enrich_fn=resolved_catalog)
    assert not (tmp_path / "public/stats.json").exists()


@pytest.mark.parametrize("problem", ["checksum", "path", "missing_gold", "missing_hash", "mismatch"])
def test_invalid_snapshots_fail_before_any_remote_write(lake, tmp_path, problem):
    cp = json.loads(lake.blobs[checkpoint.CHECKPOINT_BLOB])
    gold = cp["snapshots"]["gold"]
    name = gold["prefix"] + "/_metadata.json"
    if problem == "checksum":
        lake.blobs[name] = b"tampered"
    elif problem == "path":
        gold["prefix"] = "gold/../../private"
    elif problem == "missing_gold":
        del cp["snapshots"]["gold"]
    elif problem == "missing_hash":
        del gold["files"][job.GOLD_FILES[-1]]
    else:
        meta = json.loads(lake.blobs[name])
        meta["source_silver_rows"] += 1
        lake.blobs[name] = json.dumps(meta).encode()
        gold["files"]["_metadata.json"] = hashlib.sha256(lake.blobs[name]).hexdigest()
    lake.blobs[checkpoint.CHECKPOINT_BLOB] = json.dumps(cp).encode()
    before = dict(lake.blobs)
    with pytest.raises(ValueError):
        export(lake, tmp_path, refresh_artwork=False)
    assert lake.blobs == before
    assert not (tmp_path / "public/stats.json").exists()


def test_missing_checkpoint_does_not_trigger_ingestion(tmp_path):
    with pytest.raises(ValueError, match="committed checkpoint"):
        export(FakeLake(), tmp_path, refresh_artwork=False)


def test_errors_do_not_log_provider_secrets(monkeypatch, tmp_path, caplog):
    def unavailable(**kwargs):
        raise ValueError("SECRET from provider")
    monkeypatch.setattr(job, "load_settings", unavailable)
    assert job.main(["--out", str(tmp_path / "stats.json")]) == 1
    assert "SECRET" not in caplog.text


def test_cloud_export_passes_the_actual_react_contract(lake, tmp_path):
    export(lake, tmp_path, enrich_fn=resolved_catalog)
    node = shutil.which("node")
    assert node is not None, "Install Node 22 to run the Python/React compatibility test"
    script = Path(__file__).resolve().parents[1] / "frontend/scripts/check-stats.ts"
    result = subprocess.run([node, "--experimental-strip-types", str(script), str(tmp_path / "public/stats.json")],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert "Verified public StatsFile v1" in result.stdout


def test_checkpoint_is_read_once_even_if_the_pipeline_advances(lake, tmp_path):
    original = lake.read_bytes
    reads = []
    def read(name):
        reads.append(name)
        found = original(name)
        if name == checkpoint.CHECKPOINT_BLOB:
            lake.blobs[name] = b'{"schema_version":1,"snapshots":{}}'
        return found
    lake.read_bytes = read
    _, document = export(lake, tmp_path, refresh_artwork=False)
    assert document["totals"]["scrobbles"] == 1
    assert reads.count(checkpoint.CHECKPOINT_BLOB) == 1


def test_cli_removes_private_temporaries_after_failure(monkeypatch, tmp_path):
    from unittest.mock import MagicMock
    storage = MagicMock()
    monkeypatch.setattr(job, "AzureStorage", lambda settings: storage)
    monkeypatch.setattr(job, "load_settings", lambda **kwargs: None)
    directories = []
    def fail(store, work, *args, **kwargs):
        directories.append(work)
        (work / "private.parquet").write_bytes(b"private fixture")
        raise RuntimeError("private provider response")
    monkeypatch.setattr(job, "run_export", fail)
    assert job.main(["--out", str(tmp_path / "stats.json")]) == 1
    assert directories and not directories[0].exists()


def test_missing_consistency_timestamp_is_rejected(lake, tmp_path):
    cp = json.loads(lake.blobs[checkpoint.CHECKPOINT_BLOB])
    for layer, field in (("silver", "last_transformed_at"), ("gold", "source_silver_updated_at")):
        record = cp["snapshots"][layer]
        name = record["prefix"] + "/_metadata.json"
        meta = json.loads(lake.blobs[name])
        meta.pop(field)
        lake.blobs[name] = json.dumps(meta).encode()
        record["files"]["_metadata.json"] = hashlib.sha256(lake.blobs[name]).hexdigest()
    lake.blobs[checkpoint.CHECKPOINT_BLOB] = json.dumps(cp).encode()
    with pytest.raises(job.ExportRejected, match="same dataset"):
        export(lake, tmp_path, refresh_artwork=False)


def test_artist_photos_are_cached_and_only_exact_matches_are_shown(lake, tmp_path):
    deezer = FakeDeezer()
    export(lake, tmp_path / "first", deezer=deezer)
    assert deezer.calls == ["Fictional Artist"]
    page = json.loads((tmp_path / "first/public/artists/fictional-artist.json").read_text(encoding="utf-8"))
    assert page["photo"]["url"].startswith("https://e-cdns-images.dzcdn.net/")
    again = FakeDeezer()
    export(lake, tmp_path / "second", deezer=again)
    assert again.calls == []  # resolved artists are not queried again


def test_a_clearly_dominant_namesake_is_accepted():
    results = [{"id": 7, "name": "Fictional Artist", "nb_fan": 12, "link": "https://www.deezer.com/artist/7",
                "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/small/1.jpg"},
               {"id": 1, "name": "Fictional Artist", "nb_fan": 500000, "link": "https://www.deezer.com/artist/1",
                "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/big/1.jpg"}]
    chosen = artist_photos.match("Fictional Artist", results)
    assert chosen["status"] == "resolved" and chosen["source_url"].endswith("/artist/1")
    results[0]["nb_fan"] = 100000  # only 5x: too close to call
    assert artist_photos.match("Fictional Artist", results)["status"] == "needs_review"


@pytest.mark.parametrize("results,status", [
    ([], "not_found"),
    ([{"id": 1, "name": "Fictional Artist", "link": "https://www.deezer.com/artist/1",
       "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg"}], "not_found"),
    ([{"id": 1, "name": "Fictional Artist", "link": "https://www.deezer.com/artist/1", "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/a/1.jpg"},
      {"id": 2, "name": "fictional artist", "link": "https://www.deezer.com/artist/2", "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/b/1.jpg"}], "needs_review"),
    ([{"id": 3, "name": "Fictional Artists Band", "link": "https://www.deezer.com/artist/3", "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/c/1.jpg"}], "not_found"),
])
def test_ambiguous_or_placeholder_photos_are_never_shown(lake, tmp_path, results, status):
    export(lake, tmp_path, deezer=FakeDeezer(results))
    catalog = json.loads(lake.blobs[artist_photos.CATALOG_BLOB])
    assert catalog[0]["status"] == status
    page = json.loads((tmp_path / "public/artists/fictional-artist.json").read_text(encoding="utf-8"))
    assert page["photo"] is None


def test_recent_and_explore_ship_with_the_same_release(lake, tmp_path):
    summary, document = export(lake, tmp_path)
    recent = json.loads((tmp_path / "public/recent.json").read_text(encoding="utf-8"))
    explore = json.loads((tmp_path / "public/explore.json").read_text(encoding="utf-8"))
    assert recent["data_as_of"] == document["data_as_of"]
    assert set(recent["periods"]) == {"today", "this_week", "last_week", "this_month", "last_month"}
    assert explore["genres"]["families"][0]["family"] == "rock"
    assert explore["year_ranks"][0]["top_artists"][0]["name"] == "Fictional Artist"


def test_genres_are_cached_between_exports(lake, tmp_path):
    first = FakeTags()
    export(lake, tmp_path / "a", tags_client=first)
    assert [name for name, _ in first.calls] == ["Fictional Artist"]
    again = FakeTags()
    export(lake, tmp_path / "b", tags_client=again)
    assert again.calls == []

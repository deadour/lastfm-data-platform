import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pandas as pd
import pytest

from src.artwork import clients, enrich
from src.artwork.export_frontend import build
from src.artwork.matching import album_key, decide, normalize
from src.analytics.gold_builder import build_gold
from src.transformation.transform_scrobbles import transform
from tests.test_silver_pipeline import make_run

MBID = "11111111-1111-1111-1111-111111111111"
RG = "22222222-2222-2222-2222-222222222222"


def test_album_key_ignores_case_accents_and_edition_noise():
    assert album_key("Björk", "Homogenic (Remastered 2015)") == album_key("bjork", "homogenic")
    assert album_key("The National", "Boxer [Deluxe Edition]") == album_key("National", "Boxer")
    assert album_key("A", "Blue") != album_key("A", "Blue Train")
    assert normalize("Simon & Garfunkel") == "simon and garfunkel"


@pytest.mark.parametrize("candidates,status", [
    ([("Radiohead", "OK Computer")], "resolved"),
    ([("Radiohead", "OK Computer"), ("Radiohead", "OK Computer")], "resolved"),         # duplicate uploads
    ([("Radiohead", "OK Computer"), ("Radiohead", "OK Computer OKNOTOK")], "needs_review"),
    ([("Radiohead", "OK Computers")], "needs_review"),                                  # close, not exact
    ([("Some Tribute Band", "OK Computer")], "not_found"),                              # right title, wrong artist
    ([], "not_found"),
])
def test_fallback_matches_are_conservative(candidates, status):
    assert decide("Radiohead", "OK Computer", candidates).status == status


class FakeCAA:
    def __init__(self, fronts):
        self.fronts, self.calls = fronts, []

    def front(self, entity, mbid):
        self.calls.append((entity, mbid))
        return self.fronts.get((entity, mbid))


class FakeMB:
    def __init__(self, groups=None):
        self.groups = groups or {}

    def release_group(self, mbid):
        return self.groups.get(mbid)


class FakeDeezer:
    def __init__(self, results=None, fail=False):
        self.results, self.fail, self.calls = results or [], fail, 0

    def search_albums(self, artist, album):
        self.calls += 1
        if self.fail:
            raise clients.ArtworkError("deezer down")
        return self.results


def deezer_item(artist, title, id_=1):
    return {"id": id_, "title": title, "artist": {"name": artist}, "cover_xl": f"https://cdn.example/{id_}.jpg",
            "link": f"https://www.deezer.com/album/{id_}"}


ALBUM = {"album_key": "k", "artist_name": "Radiohead", "album_name": "OK Computer", "album_mbid": MBID, "scrobbles": 9}


def test_release_mbid_uses_cover_art_archive_first():
    deezer = FakeDeezer()
    record = enrich.resolve(ALBUM, FakeCAA({("release", MBID): "https://caa/500.jpg"}), FakeMB(), deezer)
    assert (record["status"], record["provider"], record["match_confidence"]) == ("resolved", "coverartarchive", 1.0)
    assert record["source_url"] == f"https://musicbrainz.org/release/{MBID}" and deezer.calls == 0


def test_release_group_fallback_before_deezer():
    caa = FakeCAA({("release-group", RG): "https://caa/rg.jpg"})
    record = enrich.resolve(ALBUM, caa, FakeMB({MBID: RG}), FakeDeezer())
    assert record["release_group_mbid"] == RG and record["match_confidence"] == 0.95
    assert caa.calls == [("release", MBID), ("release-group", RG)]


def test_deezer_fallback_without_mbid():
    album = {**ALBUM, "album_mbid": ""}
    caa = FakeCAA({})
    record = enrich.resolve(album, caa, FakeMB(), FakeDeezer([deezer_item("Radiohead", "OK Computer", 7)]))
    assert (record["status"], record["provider"], record["provider_id"]) == ("resolved", "deezer", "7")
    assert caa.calls == [] and record["album_mbid"] is None


def test_ambiguous_deezer_result_is_never_resolved():
    album = {**ALBUM, "album_mbid": ""}
    results = [deezer_item("Radiohead", "OK Computer", 1), deezer_item("Radiohead", "OK Computer OKNOTOK", 2)]
    record = enrich.resolve(album, FakeCAA({}), FakeMB(), FakeDeezer(results))
    assert record["status"] == "needs_review" and record["match_reason"] == "competing candidates"


def silver_frame(rows):
    return pd.DataFrame(rows, columns=["artist_name", "album_name", "album_mbid"])


@pytest.fixture
def silver(tmp_path):
    rows = ([("Radiohead", "OK Computer", MBID)] * 3 + [("Radiohead", "ok computer (remastered)", "")]
            + [("Nobody", "Nothing", "")] * 2 + [("Unclear", "Maybe", "")] + [("Solo", "", "")])
    path = tmp_path / "silver.parquet"
    silver_frame(rows).to_parquet(path)
    return path


def test_albums_merge_spellings_and_skip_missing_titles(silver):
    albums = enrich.albums_from_silver(pd.read_parquet(silver))
    first = albums.iloc[0]
    assert (first.album_name, first.album_mbid, first.scrobbles) == ("OK Computer", MBID, 4)
    assert len(albums) == 3


def fake_clients(**deezer):
    return (FakeCAA({("release", MBID): "https://caa/500.jpg"}), FakeMB(),
            FakeDeezer([deezer_item("Unclear", "Maybe?"), deezer_item("Unclear", "Maybe Not", 2)], **deezer))


def test_incremental_run_skips_resolved_and_review_and_retries_old_misses(silver, tmp_path):
    out = tmp_path / "artwork"
    counts = enrich.run(silver, 10, 30, "ua", 0, out, clients=fake_clients())
    catalog = enrich.read_catalog(out)
    statuses = dict(zip(catalog.album_name, catalog.status))
    assert statuses == {"OK Computer": "resolved", "Nothing": "not_found", "Maybe": "needs_review"}
    assert counts["checked"] == 3 and json.loads((out / "catalog.json").read_text())[0]["album_name"] == "OK Computer"

    second = fake_clients()
    assert enrich.run(silver, 10, 30, "ua", 0, out, clients=second)["checked"] == 0
    assert second[0].calls == [] and second[2].calls == 0

    catalog.loc[catalog.album_name == "Nothing", "checked_at"] = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    enrich.write_catalog(catalog, out)
    third = fake_clients()
    assert enrich.run(silver, 10, 30, "ua", 0, out, clients=third)["checked"] == 1  # only the stale miss


def test_provider_failure_stops_but_keeps_progress(silver, tmp_path):
    out = tmp_path / "artwork"
    counts = enrich.run(silver, 10, 30, "ua", 0, out, clients=fake_clients(fail=True))
    assert counts["stopped"] == 1
    assert list(enrich.read_catalog(out).album_name) == ["OK Computer"]  # resolved before the failure


def test_manual_review_accept_and_reject(silver, tmp_path):
    out = tmp_path / "artwork"
    enrich.run(silver, 10, 30, "ua", 0, out, clients=fake_clients())
    catalog = enrich.read_catalog(out)
    key = catalog.loc[catalog.status == "needs_review", "album_key"].item()
    assert enrich.review(catalog.copy(), key, True).set_index("album_key").loc[key, "status"] == "resolved"
    assert enrich.review(catalog.copy(), key, False).set_index("album_key").loc[key, "status"] == "rejected"
    with pytest.raises(ValueError):
        enrich.review(catalog, catalog.loc[catalog.status == "resolved", "album_key"].item(), True)


class FakeResponse:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self.body, self.headers = status, body, headers or {}

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise clients.requests.HTTPError(str(self.status_code))


class FakeSession:
    def __init__(self, responses):
        self.responses, self.headers, self.calls = list(responses), {}, []

    def get(self, url, params=None, timeout=None):
        self.calls.append(params)
        return self.responses.pop(0)


def paced(cls, responses, **kw):
    session = FakeSession(responses)
    return cls("ua", session=session, sleep=lambda s: None, **kw), session


def test_rate_limited_requests_are_retried():
    deezer, session = paced(clients.Deezer, [FakeResponse(429, headers={"Retry-After": "2"}),
                                             FakeResponse(200, {"error": {"code": 4, "message": "Quota"}}),
                                             FakeResponse(200, {"data": [deezer_item("A", "B")]})])
    assert deezer.search_albums("A", "B")[0]["title"] == "B" and len(session.calls) == 3
    assert session.calls[0]["q"] == 'artist:"A" album:"B"'


def test_persistent_failures_raise_and_404_is_a_miss():
    caa, _ = paced(clients.CoverArtArchive, [FakeResponse(503)] * 4)
    with pytest.raises(clients.ArtworkError):
        caa.front("release", MBID)
    caa, _ = paced(clients.CoverArtArchive, [FakeResponse(404)])
    assert caa.front("release", MBID) is None


def test_cover_art_archive_picks_approved_front_thumbnail():
    images = {"images": [{"front": False, "thumbnails": {"500": "back"}},
                         {"front": True, "approved": False, "thumbnails": {"500": "unapproved"}},
                         {"front": True, "approved": True, "thumbnails": {"250": "small", "500": "front-500"}}]}
    caa, _ = paced(clients.CoverArtArchive, [FakeResponse(200, images)])
    assert caa.front("release", MBID) == "front-500"


def test_pacing_waits_between_requests():
    waits, clock = [], iter([0.0, 0.2, 0.2])
    deezer = clients.Deezer("ua", interval=0.5, session=FakeSession([FakeResponse(200, {"data": []})] * 2),
                            sleep=waits.append, monotonic=lambda: next(clock))
    deezer.search_albums("a", "b")
    deezer.search_albums("a", "b")
    assert waits and abs(waits[0] - 0.3) < 1e-9


def test_frontend_export_matches_statsfile_contract_and_stays_private(tmp_path):
    make_run(tmp_path / "bronze", "run-one", 1700000000)
    make_run(tmp_path / "bronze", "run-two", 1700003600)
    transform(full=True, bronze_root=tmp_path / "bronze", silver_root=tmp_path / "silver")
    silver = tmp_path / "silver" / "scrobbles" / "scrobbles.parquet"
    build_gold(silver_path=silver, gold_root=tmp_path / "gold")
    key = album_key("Fictional Artist", "Fictional Album")
    catalog = pd.DataFrame([{**{c: None for c in enrich.COLUMNS}, "album_key": key, "status": "needs_review",
                             "image_url": "https://cdn-images.dzcdn.net/x.jpg", "provider": "deezer"}])

    document = build(tmp_path / "gold", silver, catalog)
    # Fields the frontend loader requires (frontend/src/data/types.ts StatsFile).
    assert document["schema_version"] == 1 and document["source"] == "gold"
    assert set(document["range"]) == {"first", "last"}
    assert {"scrobbles", "artists", "tracks", "active_days"} <= set(document["totals"])
    assert set(document["years"][0]) == {"year", "scrobbles", "artists", "tracks", "top_artist", "partial"}
    assert set(document["months"][0]) == {"month", "scrobbles"}
    assert set(document["top_artists"][0]) == {"name", "scrobbles", "image"}
    assert set(document["top_tracks"][0]) == {"title", "artist", "scrobbles", "image"}
    assert len(document["rhythm"]) == 168 and abs(sum(c["share"] for c in document["rhythm"]) - 1) < 1e-3
    assert set(document["longest_streak"]) == {"days", "start", "end"}
    assert document["years"][0]["partial"] is True  # 2023 is only partly covered

    assert document["top_albums"][0]["cover"] is None and document["top_albums"][0]["image"] is None
    assert document["top_tracks"][0]["image"] is None  # needs_review never exported
    catalog.loc[0, "status"] = "resolved"
    document = build(tmp_path / "gold", silver, catalog)
    assert document["top_albums"][0]["image"] == "https://cdn-images.dzcdn.net/x.jpg"
    assert document["top_albums"][0]["cover"]["attribution"] == "deezer"
    assert document["top_tracks"][0]["image"] == "https://cdn-images.dzcdn.net/x.jpg"  # via its album
    assert document["totals"]["scrobbles"] == 2

    text = json.dumps(document)
    assert "fictional-user" not in text and "blob.core.windows.net" not in text and str(tmp_path) not in text
    assert len(text) < 20_000


def test_musicbrainz_release_lookup_retries_then_succeeds():
    responses = [FakeResponse(503), FakeResponse(200, {"release-group": {"id": RG}})]
    mb = clients.MusicBrainzReleases("ua", interval_seconds=0, session=FakeSession(responses), sleep=lambda s: None)
    assert mb.release_group(MBID) == RG
    failing = clients.MusicBrainzReleases("ua", interval_seconds=0, session=FakeSession([FakeResponse(503)] * 3),
                                          sleep=lambda s: None)
    with pytest.raises(clients.ArtworkError):
        failing.release_group(MBID)


@pytest.mark.parametrize("url,expected", [
    ("http://coverartarchive.org/release/x/1-500.jpg", "https://coverartarchive.org/release/x/1-500.jpg"),
    ("http://ia800.us.archive.org/a.jpg", "https://ia800.us.archive.org/a.jpg"),
    ("HTTP://archive.org/a.jpg", "https://archive.org/a.jpg"),
    ("https://coverartarchive.org/a.jpg", "https://coverartarchive.org/a.jpg"),
    ("http://example.com/a.jpg", "http://example.com/a.jpg"),         # unknown host left alone (then not exported)
    ("http://notarchive.org/a.jpg", "http://notarchive.org/a.jpg"),
    (None, None),
])
def test_https_url_only_upgrades_cover_art_archive_hosts(url, expected):
    assert clients.https_url(url) == expected


def test_cover_art_archive_client_returns_https_urls():
    images = {"images": [{"front": True, "approved": True, "thumbnails": {"500": "http://coverartarchive.org/release/x/1-500.jpg"}}]}
    caa, _ = paced(clients.CoverArtArchive, [FakeResponse(200, images)])
    assert caa.front("release", MBID) == "https://coverartarchive.org/release/x/1-500.jpg"


def test_existing_http_catalog_rows_are_upgraded_on_read(tmp_path):
    out = tmp_path / "artwork"
    row = {**{c: None for c in enrich.COLUMNS}, "album_key": "k", "status": "resolved", "provider": "coverartarchive",
           "image_url": "http://coverartarchive.org/release/x/1-500.jpg", "scrobbles": 1}
    enrich.write_catalog(pd.DataFrame([row]), out)
    assert enrich.read_catalog(out).loc[0, "image_url"].startswith("https://")


def test_export_never_contains_http_images(tmp_path):
    make_run(tmp_path / "bronze", "run-one", 1700000000)
    transform(full=True, bronze_root=tmp_path / "bronze", silver_root=tmp_path / "silver")
    silver = tmp_path / "silver" / "scrobbles" / "scrobbles.parquet"
    build_gold(silver_path=silver, gold_root=tmp_path / "gold")
    key = album_key("Fictional Artist", "Fictional Album")
    catalog = pd.DataFrame([{**{c: None for c in enrich.COLUMNS}, "album_key": key, "status": "resolved",
                             "provider": "coverartarchive", "image_url": "http://example.com/plain.jpg"}])
    document = build(tmp_path / "gold", silver, catalog)
    images = [a["image"] for a in document["top_albums"]] + [t["image"] for t in document["top_tracks"]]
    assert all(url is None or url.startswith("https://") for url in images)
    assert "http://" not in json.dumps(document)

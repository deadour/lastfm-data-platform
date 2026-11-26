from datetime import datetime, timedelta, timezone

import pandas as pd

from src.artwork import export_explore as explore
from src.enrichment import cloud_genres
from src.enrichment.lastfm_tags_client import LastFMTagError

TAXONOMY = {"max_tags_per_artist": 5, "noise": ["seen live"],
            "genre_family": {"rock": ["rock", "rock argentino", "new wave"], "metal": ["progressive metal"],
                             "pop": ["pop"]}}


class Client:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def get_top_tags(self, artist, mbid=None):
        self.calls.append((artist, mbid))
        answer = self.answers[(artist, mbid)]
        if isinstance(answer, Exception):
            raise answer
        return {"toptags": {"tag": [{"name": t, "count": 10} for t in answer]}}


def test_mbid_beats_a_namesake():
    client = Client({("Virus", "mb-virus-ar"): ["new wave", "rock argentino"]})
    catalog = {}
    cloud_genres.refresh(catalog, ["Virus"], client, mbids={"Virus": "mb-virus-ar"})
    assert client.calls == [("Virus", "mb-virus-ar")]
    assert cloud_genres.Genres(catalog, TAXONOMY).primary("Virus") == "rock"


def test_unknown_mbid_falls_back_to_name_and_other_errors_stop():
    client = Client({("A", "bad"): LastFMTagError("Last.fm artist tag error 6"), ("A", None): ["pop"],
                     ("B", None): LastFMTagError("Last.fm artist tag error 29"), ("C", None): ["rock"]})
    catalog = {}
    checked = cloud_genres.refresh(catalog, ["A", "B", "C"], client, mbids={"A": "bad"})
    assert checked == 1 and cloud_genres.Genres(catalog, TAXONOMY).primary("A") == "pop"
    assert "c" not in catalog  # a rate limit stops the run instead of marking artists empty


def test_refresh_windows_and_limit():
    old = (datetime.now(timezone.utc) - timedelta(days=200)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    recent = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    catalog = {"a": {"artist": "A", "status": "resolved", "tags": [], "checked_at": recent},
               "b": {"artist": "B", "status": "resolved", "tags": [], "checked_at": old}}
    client = Client({("B", None): ["rock"], ("C", None): ["pop"], ("D", None): ["pop"]})
    assert cloud_genres.refresh(catalog, ["A", "B", "C", "D"], client, limit=2) == 2
    assert [c[0] for c in client.calls] == ["B", "C"]


def test_family_weights_ignore_noise_and_follow_rank():
    catalog = {}
    cloud_genres.refresh(catalog, ["X"], Client({("X", None): ["seen live", "rock", "pop", "unknown tag"]}))
    genres = cloud_genres.Genres(catalog, TAXONOMY)
    families = genres.families("X")
    assert families["rock"] > families["pop"] and abs(sum(families.values()) - 1) < 1e-9
    assert genres.style("X") == "rock" and "seen live" not in genres.tags("X")
    assert cloud_genres.load(cloud_genres.dump(catalog)) == catalog


def events(rows):
    frame = pd.DataFrame(rows, columns=["artist_name", "track_name", "album_name", "local_date"])
    frame["local_date"] = pd.to_datetime(frame["local_date"]).dt.date
    frame["scrobbled_at_local"] = pd.to_datetime(frame["local_date"]) + pd.to_timedelta(range(len(frame)), unit="m")
    frame["local_hour"] = frame["scrobbled_at_local"].dt.hour
    frame["local_year"] = frame["scrobbled_at_local"].dt.year
    return frame


def test_recent_windows_are_anchored_to_the_last_day_with_data():
    frame = events([("A", "t1", "", "2026-01-01")] * 3 + [("B", "t2", "", "2026-01-09")] * 2 + [("A", "t1", "", "2026-01-10")])
    recent = explore.recent(frame)
    assert recent["anchor"] == "2026-01-10" and recent["day"]["plays"] == 1
    assert recent["week"]["plays"] == 3 and recent["week"]["previous_plays"] == 3
    assert recent["week"]["new_artists"] == [{"name": "B", "plays": 2}]


def test_video_titles_are_not_artists():
    title = "🤣 por que el coyote quiere alcanzar al correcaminos??"
    frame = events([(title, "x", "", "2026-01-01")] * 20 + [("Real Band", "x", "", "2026-01-02")] * 20)
    assert [r["name"] for r in explore.rarities(frame)["one_day"]] == ["Real Band"]

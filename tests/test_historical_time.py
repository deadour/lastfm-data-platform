import pandas as pd

from src.analytics.historical_time import add_historical_local_time


def _events(values):
    return pd.DataFrame({"scrobble_id": [f"e{i}" for i in range(len(values))], "scrobbled_at": pd.to_datetime(values, utc=True)})


def test_before_france_is_argentina_and_utc_is_unchanged():
    source = _events(["2026-01-27T22:59:59Z"])
    result = add_historical_local_time(source)
    assert result.loc[0, "scrobbled_at"] == source.loc[0, "scrobbled_at"]
    assert result.loc[0, "timezone_name"] == "America/Argentina/Cordoba"
    assert result.loc[0, "location"] == "Argentina"
    assert result.loc[0, "local_hour"] == 19


def test_france_boundary_and_standard_time():
    source = _events(["2026-01-28T00:00:00Z", "2026-02-01T12:00:00Z"])
    result = add_historical_local_time(source)
    assert result["timezone_name"].tolist() == ["Europe/Paris", "Europe/Paris"]
    assert result["local_hour"].tolist() == [1, 13]
    assert result["local_weekday"].tolist() == [2, 6]


def test_france_dst_and_june_24_boundary():
    source = _events(["2026-04-01T12:00:00Z", "2026-06-24T21:59:59Z", "2026-06-24T22:00:00Z", "2026-06-25T03:00:00Z"])
    result = add_historical_local_time(source)
    assert result["timezone_name"].tolist() == ["Europe/Paris", "Europe/Paris", "America/Argentina/Cordoba", "America/Argentina/Cordoba"]
    assert result.loc[0, "local_hour"] == 14  # CEST, UTC+2
    assert result.loc[1, "local_date"].isoformat() == "2026-06-24"
    assert result.loc[2, "local_hour"] == 19
    assert result.loc[3, "local_hour"] == 0


def test_after_france_is_argentina_and_cardinality_is_preserved():
    source = _events(["2026-06-25T03:00:00Z", "2026-07-01T12:00:00Z"])
    result = add_historical_local_time(source)
    assert len(result) == len(source)
    assert result["location"].tolist() == ["Argentina", "Argentina"]
    assert result["local_hour"].tolist() == [0, 9]
    assert result["local_weekday"].tolist() == [3, 2]

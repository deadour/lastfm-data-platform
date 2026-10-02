import pytest
import requests

from src.ingestion.lastfm_client import LastFMAPIError, LastFMClient, LastFMHTTPError


class FakeResponse:
    def __init__(self, body, error=None):
        self.body = body
        self.error = error

    def raise_for_status(self):
        if self.error:
            raise self.error

    def json(self):
        return self.body


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.params = None

    def get(self, endpoint, params, timeout):
        self.params = params
        return self.response


def valid_payload():
    return {"recenttracks": {"track": [], "@attr": {"page": "1", "totalPages": "1"}}}


def test_get_recent_tracks_builds_request():
    session = FakeSession(FakeResponse(valid_payload()))
    result = LastFMClient("key", "user", session=session).get_recent_tracks(page=2, limit=50, from_timestamp=10)
    assert result == valid_payload()
    assert session.params["page"] == 2
    assert session.params["limit"] == 50
    assert session.params["from"] == 10


def test_api_error_is_raised():
    session = FakeSession(FakeResponse({"error": 6, "message": "User not found"}))
    with pytest.raises(LastFMAPIError, match="User not found"):
        LastFMClient("key", "user", session=session).get_recent_tracks()


def test_http_error_is_raised():
    session = FakeSession(FakeResponse({}, requests.Timeout("timed out")))
    with pytest.raises(LastFMHTTPError, match="timed out"):
        LastFMClient("key", "user", session=session).get_recent_tracks()

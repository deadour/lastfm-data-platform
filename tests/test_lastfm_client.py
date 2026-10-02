import logging

import pytest
import requests

from src.ingestion.lastfm_client import LastFMAPIError, LastFMClient, LastFMHTTPError


class FakeResponse:
    def __init__(self, body, error=None, status_code=200, text=""):
        self.body = body
        self.error = error
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.error:
            if isinstance(self.error, requests.HTTPError):
                self.error.response = self
            raise self.error

    def json(self):
        return self.body


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.endpoint = None
        self.params = None

    def get(self, endpoint, params, timeout):
        self.endpoint = endpoint
        self.params = params
        return self.response


def valid_payload():
    return {"recenttracks": {"track": [], "@attr": {"page": "1", "totalPages": "1"}}}


def test_get_recent_tracks_builds_request():
    session = FakeSession(FakeResponse(valid_payload()))
    result = LastFMClient("sentinel", "user", session=session).get_recent_tracks(page=2, limit=50, from_timestamp=10)
    assert result == valid_payload()
    assert session.params["page"] == 2
    assert session.params["limit"] == 50
    assert session.params["from"] == 10


def test_request_uses_public_recent_tracks_contract():
    session = FakeSession(FakeResponse(valid_payload()))
    LastFMClient("sentinel", "eduramirez87", session=session).get_recent_tracks()
    assert session.endpoint == "https://ws.audioscrobbler.com/2.0/"
    assert session.params == {
        "method": "user.getRecentTracks",
        "user": "eduramirez87",
        "api_key": "sentinel",
        "format": "json",
        "page": 1,
        "limit": 200,
    }
    assert not {"sk", "api_sig", "session", "session_key"}.intersection(session.params)


def test_debug_request_parameters_redact_api_key(caplog):
    session = FakeSession(FakeResponse(valid_payload()))
    with caplog.at_level(logging.DEBUG, logger="src.ingestion.lastfm_client"):
        LastFMClient("sentinel", "eduramirez87", session=session).get_recent_tracks()
    message = caplog.records[-1].message
    assert "method=user.getRecentTracks" in message
    assert "user=eduramirez87" in message
    assert "format=json" in message
    assert "api_key=[REDACTED]" in message
    assert "sentinel" not in message
    assert "https://" not in message


def test_api_error_is_raised():
    session = FakeSession(FakeResponse({"error": 6, "message": "User not found"}))
    with pytest.raises(LastFMAPIError, match="User not found"):
        LastFMClient("key", "user", session=session).get_recent_tracks()


def test_http_error_is_raised():
    session = FakeSession(FakeResponse({}, requests.Timeout("timed out")))
    with pytest.raises(LastFMHTTPError, match="Timeout") as error:
        LastFMClient("sentinel", "user", session=session).get_recent_tracks()
    assert "sentinel" not in str(error.value)


def test_http_error_reports_status_and_safe_lastfm_message():
    response = FakeResponse(
        {"error": 10, "message": "Invalid API key"},
        requests.HTTPError("request URL must not leak"),
        status_code=403,
    )
    with pytest.raises(LastFMHTTPError) as error:
        LastFMClient("sentinel", "user", session=FakeSession(response)).get_recent_tracks()
    message = str(error.value)
    assert "HTTP status 403" in message
    assert "Last.fm error 10: Invalid API key" in message
    assert "sentinel" not in message
    assert "request URL" not in message


def test_http_error_redacts_credential_like_body_values():
    response = FakeResponse(
        None,
        requests.HTTPError(),
        status_code=403,
        text="api_key=sentinel&shared_secret=not-a-secret",
    )
    with pytest.raises(LastFMHTTPError) as error:
        LastFMClient("sentinel", "user", session=FakeSession(response)).get_recent_tracks()
    message = str(error.value)
    assert "sentinel" not in message
    assert "not-a-secret" not in message

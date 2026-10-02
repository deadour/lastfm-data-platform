"""Small HTTP client for the official Last.fm API."""

from typing import Any

import requests


class LastFMError(RuntimeError):
    """Base class for Last.fm ingestion errors."""


class LastFMHTTPError(LastFMError):
    """Raised when the API request fails at the HTTP layer."""


class LastFMAPIError(LastFMError):
    """Raised when Last.fm returns an API-level error."""


class LastFMResponseError(LastFMError):
    """Raised when Last.fm returns an unexpected response shape."""


class LastFMClient:
    endpoint = "https://ws.audioscrobbler.com/2.0/"

    def __init__(self, api_key: str, username: str, timeout: float = 30, session: requests.Session | None = None):
        self.api_key = api_key
        self.username = username
        self.timeout = timeout
        self.session = session or requests.Session()

    def get_recent_tracks(self, page: int = 1, limit: int = 200, from_timestamp: int | None = None,
                          to_timestamp: int | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {
            "method": "user.getRecentTracks", "user": self.username, "api_key": self.api_key,
            "format": "json", "page": page, "limit": limit,
        }
        if from_timestamp is not None:
            params["from"] = from_timestamp
        if to_timestamp is not None:
            params["to"] = to_timestamp

        try:
            response = self.session.get(self.endpoint, params=params, timeout=self.timeout)
            response.raise_for_status()
        except requests.RequestException as exc:
            # Requests may include the full URL, including the API key, in its exception text.
            raise LastFMHTTPError(f"Last.fm request failed ({type(exc).__name__})") from None
        try:
            payload = response.json()
        except ValueError as exc:
            raise LastFMResponseError("Last.fm returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise LastFMResponseError("Last.fm returned a non-object JSON response")
        if "error" in payload:
            raise LastFMAPIError(f"Last.fm API error {payload.get('error')}: {payload.get('message', 'unknown error')}")
        recent_tracks = payload.get("recenttracks")
        if not isinstance(recent_tracks, dict) or not isinstance(recent_tracks.get("track", []), list):
            raise LastFMResponseError("Last.fm response is missing recenttracks.track")
        return payload

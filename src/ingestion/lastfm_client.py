"""Small HTTP client for the official Last.fm API."""

from typing import Any
import json
import re

import requests


class LastFMError(RuntimeError):
    """Base class for Last.fm ingestion errors."""


class LastFMHTTPError(LastFMError):
    """Raised when the API request fails at the HTTP layer."""


class LastFMAPIError(LastFMError):
    """Raised when Last.fm returns an API-level error."""


class LastFMResponseError(LastFMError):
    """Raised when Last.fm returns an unexpected response shape."""


_SENSITIVE_VALUE = re.compile(
    r"(?i)((?:api[_-]?key|shared[_-]?secret|password|token)\s*[=:]\s*[\"']?)[^\"'&,\s}]+"
)


def _redact_sensitive(value: str, api_key: str) -> str:
    """Remove credential-like values before text reaches an exception or log."""
    redacted = value.replace(api_key, "[redacted]") if api_key else value
    return _SENSITIVE_VALUE.sub(r"\1[redacted]", redacted)


def _safe_http_detail(response: Any, api_key: str) -> str:
    """Extract a bounded Last.fm error detail without exposing request secrets."""
    if response is None:
        return ""
    try:
        body = response.json()
    except (AttributeError, ValueError):
        body = None
    if isinstance(body, dict):
        message = body.get("message")
        error_code = body.get("error")
        if message is not None:
            detail = f"Last.fm error {error_code}: {message}" if error_code is not None else str(message)
        else:
            detail = json.dumps(body, ensure_ascii=True)[:300]
    else:
        detail = str(getattr(response, "text", ""))[:300].strip()
    return _redact_sensitive(detail, api_key)


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
        except requests.HTTPError as exc:
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", "unknown")
            detail = _safe_http_detail(response, self.api_key)
            suffix = f": {detail}" if detail else ""
            raise LastFMHTTPError(f"Last.fm request failed with HTTP status {status}{suffix}") from None
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
            message = _redact_sensitive(str(payload.get("message", "unknown error")), self.api_key)
            raise LastFMAPIError(f"Last.fm API error {payload.get('error')}: {message}")
        recent_tracks = payload.get("recenttracks")
        if not isinstance(recent_tracks, dict) or not isinstance(recent_tracks.get("track", []), list):
            raise LastFMResponseError("Last.fm response is missing recenttracks.track")
        return payload

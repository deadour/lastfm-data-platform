"""Last.fm artist tag client with bounded retries and no credential caching."""

import logging
import time
from typing import Any

import requests


LOGGER = logging.getLogger(__name__)


class LastFMTagError(RuntimeError):
    """Raised when Last.fm artist tags cannot be retrieved."""


class LastFMArtistTagsClient:
    endpoint = "https://ws.audioscrobbler.com/2.0/"

    def __init__(self, api_key: str, interval_seconds: float = 0.5, timeout: float = 30,
                 session: requests.Session | None = None, sleep=time.sleep, monotonic=time.monotonic):
        self.api_key = api_key
        self.interval_seconds = interval_seconds
        self.timeout = timeout
        self.session = session or requests.Session()
        self.sleep = sleep
        self.monotonic = monotonic
        self._last_request_at: float | None = None

    def _wait_for_slot(self) -> None:
        now = self.monotonic()
        if self._last_request_at is not None:
            self.sleep(max(0.0, self.interval_seconds - (now - self._last_request_at)))
        self._last_request_at = self.monotonic()

    def get_top_tags(self, artist: str) -> dict[str, Any]:
        params = {"method": "artist.getTopTags", "artist": artist, "api_key": self.api_key, "format": "json"}
        for attempt in range(1, 4):
            self._wait_for_slot()
            try:
                response = self.session.get(self.endpoint, params=params, timeout=self.timeout)
                response.raise_for_status()
                body = response.json()
            except requests.RequestException:
                if attempt < 3:
                    self.sleep(2 ** (attempt - 1))
                    continue
                raise LastFMTagError("Last.fm artist tag request failed") from None
            except ValueError:
                raise LastFMTagError("Last.fm returned invalid JSON for artist tags") from None
            if not isinstance(body, dict):
                raise LastFMTagError("Last.fm returned an unexpected artist tag response")
            if "error" in body:
                # Keep provider bodies out of exceptions: they can contain data
                # that is not safe to emit in logs or tracebacks.
                raise LastFMTagError(f"Last.fm artist tag error {body.get('error', 'unknown')}")
            return body
        raise LastFMTagError("Last.fm artist tag retry limit reached")

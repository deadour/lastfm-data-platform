"""Conservative, rate-limited MusicBrainz API client."""

import logging
import time
from typing import Any
from urllib.parse import quote

import requests


LOGGER = logging.getLogger(__name__)


class MusicBrainzError(RuntimeError):
    """Base class for MusicBrainz failures."""


class MusicBrainzClient:
    endpoint = "https://musicbrainz.org/ws/2"

    def __init__(self, user_agent: str, interval_seconds: float = 1.0, timeout: float = 30,
                 session: requests.Session | None = None, sleep=time.sleep, monotonic=time.monotonic):
        self.user_agent = user_agent
        self.interval_seconds = interval_seconds
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept": "application/json"})
        self.sleep = sleep
        self.monotonic = monotonic
        self._last_request_at: float | None = None

    def _wait_for_slot(self) -> None:
        now = self.monotonic()
        if self._last_request_at is not None:
            self.sleep(max(0.0, self.interval_seconds - (now - self._last_request_at)))
        self._last_request_at = self.monotonic()

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any] | None:
        self._wait_for_slot()
        try:
            response = self.session.get(f"{self.endpoint}/{path}", params=params, timeout=self.timeout)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            body = response.json()
        except requests.RequestException as exc:
            raise MusicBrainzError(f"MusicBrainz request failed ({type(exc).__name__})") from None
        except ValueError:
            raise MusicBrainzError("MusicBrainz returned invalid JSON") from None
        if not isinstance(body, dict):
            raise MusicBrainzError("MusicBrainz returned an unexpected response")
        return body

    def get_artist(self, mbid: str) -> dict[str, Any] | None:
        return self._get(f"artist/{quote(mbid, safe='')}", {"fmt": "json", "inc": "aliases"})

    def search_artists(self, name: str, limit: int = 10) -> list[dict[str, Any]]:
        body = self._get("artist", {"query": f'artist:"{name}"', "fmt": "json", "limit": limit})
        if body is None:
            return []
        artists = body.get("artists", [])
        return artists if isinstance(artists, list) else []

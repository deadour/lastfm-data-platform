"""Rate-limited clients for Cover Art Archive, MusicBrainz releases and Deezer search.

All three are keyless public APIs. Only metadata and image URLs are fetched;
images themselves are never downloaded or rehosted.
"""

import logging
import time
from typing import Any
from urllib.parse import quote

import requests

from src.enrichment.musicbrainz_client import MusicBrainzClient, MusicBrainzError

LOGGER = logging.getLogger(__name__)


class ArtworkError(RuntimeError):
    """A provider failed in a way that should stop the run (not a simple miss)."""


class _Paced:
    """One request per ``interval`` seconds; retries 429/503 with backoff."""

    def __init__(self, interval: float, user_agent: str, session: requests.Session | None = None,
                 timeout: float = 20, attempts: int = 4, sleep=time.sleep, monotonic=time.monotonic):
        self.interval, self.timeout, self.attempts = interval, timeout, attempts
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept": "application/json"})
        self.sleep, self.monotonic = sleep, monotonic
        self._last: float | None = None

    def _wait(self) -> None:
        if self._last is not None:
            self.sleep(max(0.0, self.interval - (self.monotonic() - self._last)))
        self._last = self.monotonic()

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Return the JSON body, None on 404, raise ArtworkError after repeated failures."""
        for attempt in range(1, self.attempts + 1):
            self._wait()
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                error = type(exc).__name__
            else:
                if response.status_code == 404:
                    return None
                if response.status_code not in {429, 500, 502, 503, 504}:
                    try:
                        response.raise_for_status()
                        body = response.json()
                    except (requests.RequestException, ValueError) as exc:
                        raise ArtworkError(f"{url.split('/')[2]} returned an invalid response") from exc
                    if not self._quota_error(body):
                        return body
                    error = "quota"
                else:
                    error = f"HTTP {response.status_code}"
                    retry_after = response.headers.get("Retry-After", "")
                    if retry_after.isdigit():
                        self.sleep(min(int(retry_after), 60))
            if attempt < self.attempts:
                LOGGER.info("retrying %s after %s", url.split("/")[2], error)
                self.sleep(min(2 ** attempt, 30))
        raise ArtworkError(f"{url.split('/')[2]} failed after {self.attempts} attempts ({error})")

    @staticmethod
    def _quota_error(body: Any) -> bool:
        return False


HTTPS_HOSTS = ("coverartarchive.org", "archive.org")


def https_url(url: str | None) -> str | None:
    """Cover Art Archive lists many thumbnails as http://; the same paths serve over https."""
    if not url:
        return url
    scheme, sep, rest = url.partition("://")
    host = rest.split("/", 1)[0].lower()
    if sep and scheme.lower() == "http" and (host in HTTPS_HOSTS or host.endswith(".archive.org")):
        return "https://" + rest
    return url


class CoverArtArchive(_Paced):
    endpoint = "https://coverartarchive.org"

    def __init__(self, user_agent: str, interval: float = 1.0, **kwargs):
        super().__init__(interval, user_agent, **kwargs)

    def front(self, entity: str, mbid: str) -> str | None:
        """URL of the approved front image (500px thumbnail) for a release or release-group."""
        body = self.get_json(f"{self.endpoint}/{entity}/{quote(mbid, safe='')}")
        for image in (body or {}).get("images", []):
            if image.get("front") and image.get("approved", True):
                thumbs = image.get("thumbnails") or {}
                return https_url(thumbs.get("500") or thumbs.get("large") or image.get("image"))
        return None


class MusicBrainzReleases(MusicBrainzClient):
    attempts = 3

    def release_group(self, release_mbid: str) -> str | None:
        """Release-group MBID of a release, or None if the release is unknown.

        The shared client raises on any non-404 status; MusicBrainz answers 503
        when busy, so retry here with backoff before giving up.
        """
        for attempt in range(1, self.attempts + 1):
            try:
                body = self._get(f"release/{quote(release_mbid, safe='')}", {"fmt": "json", "inc": "release-groups"})
                return ((body or {}).get("release-group") or {}).get("id")
            except MusicBrainzError as exc:
                if attempt == self.attempts:
                    raise ArtworkError(str(exc)) from None
                LOGGER.info("retrying musicbrainz after %s", exc)
                self.sleep(min(2 ** attempt, 30))


class Deezer(_Paced):
    """Deezer's public search API; documented quota is 50 requests / 5 s, we stay far below."""

    endpoint = "https://api.deezer.com"

    def __init__(self, user_agent: str, interval: float = 0.5, **kwargs):
        super().__init__(interval, user_agent, **kwargs)

    @staticmethod
    def _quota_error(body: Any) -> bool:
        return isinstance(body, dict) and (body.get("error") or {}).get("code") == 4

    def search_albums(self, artist: str, album: str, limit: int = 10) -> list[dict[str, Any]]:
        query = f'artist:"{artist}" album:"{album}"'
        body = self.get_json(f"{self.endpoint}/search/album", {"q": query, "limit": limit})
        if body and body.get("error"):
            raise ArtworkError(f"Deezer error {body['error'].get('code')}")
        return [item for item in (body or {}).get("data", []) if isinstance(item, dict)]

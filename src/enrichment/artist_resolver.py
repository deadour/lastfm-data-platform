"""Conservative artist identity resolution against MusicBrainz."""

from dataclasses import dataclass
import re
from typing import Any

from .musicbrainz_client import MusicBrainzClient, MusicBrainzError


@dataclass
class Resolution:
    status: str
    method: str
    confidence: str | None
    response: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    error: str | None = None


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _candidate_names(candidate: dict[str, Any]) -> set[str]:
    names = {normalize_name(str(candidate.get("name", ""))), normalize_name(str(candidate.get("sort-name", "")))}
    aliases = candidate.get("aliases", [])
    if isinstance(aliases, list):
        names.update(normalize_name(str(alias.get("name", ""))) for alias in aliases if isinstance(alias, dict))
    return {name for name in names if name}


def resolve_candidates(artist_name: str, candidates: list[dict[str, Any]]) -> Resolution:
    """Resolve a search result set without silently selecting an ambiguous result."""
    if not candidates:
        return Resolution("not_found", "search_match", None, None, [])
    exact = [candidate for candidate in candidates if normalize_name(artist_name) in _candidate_names(candidate)]
    if len(exact) == 1:
        return Resolution("resolved", "exact_name", "high", exact[0], candidates)
    if len(exact) > 1:
        return Resolution("ambiguous", "search_match", "low", None, candidates)
    scored = [candidate for candidate in candidates if isinstance(candidate.get("score"), (int, float)) and candidate["score"] >= 95]
    if len(scored) == 1:
        return Resolution("resolved", "search_match", "medium", scored[0], candidates)
    return Resolution("ambiguous", "search_match", "low", None, candidates)


def resolve_artist(client: MusicBrainzClient, artist_name: str, existing_mbid: str | None = None) -> Resolution:
    if existing_mbid:
        try:
            response = client.get_artist(existing_mbid)
        except MusicBrainzError as exc:
            return Resolution("error", "existing_mbid", None, None, [], type(exc).__name__)
        if response and response.get("id") == existing_mbid:
            return Resolution("resolved", "existing_mbid", "high", response, [])
    try:
        candidates = client.search_artists(artist_name)
    except MusicBrainzError as exc:
        return Resolution("error", "search_match", None, None, [], type(exc).__name__)
    return resolve_candidates(artist_name, candidates)

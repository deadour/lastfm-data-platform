"""Album identity and conservative candidate matching."""

from dataclasses import dataclass
from difflib import SequenceMatcher
import hashlib
import re
import unicodedata

# Edition noise that does not change which cover is meant.
_EDITION = re.compile(
    r"\s*[\(\[][^\)\]]*\b(deluxe|remaster(ed)?|expanded|anniversary|edition|bonus|version|reissue)\b[^\)\]]*[\)\]]",
    re.IGNORECASE)


def normalize(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char)).lower()
    text = _EDITION.sub("", text).replace("&", " and ")
    text = re.sub(r"^the\s+", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def album_key(artist: str, album: str) -> str:
    """Stable id for one (artist, album) as written in Last.fm, independent of providers."""
    return hashlib.sha256(f"{normalize(artist)}\x1f{normalize(album)}".encode("utf-8")).hexdigest()[:24]


def similarity(left: str, right: str) -> float:
    a, b = normalize(left), normalize(right)
    if not a or not b:
        return 0.0
    return 1.0 if a == b else SequenceMatcher(None, a, b).ratio()


@dataclass(frozen=True)
class Decision:
    status: str          # resolved | needs_review | not_found
    confidence: float
    index: int | None    # chosen candidate, also set for needs_review as the best guess
    reason: str


ACCEPT = 0.97
REVIEW = 0.75
RIVAL = 0.6


def decide(artist: str, album: str, candidates: list[tuple[str, str]]) -> Decision:
    """Pick a fallback candidate only when it is unambiguous.

    Score = min(artist similarity, album similarity), so a perfect album title
    by the wrong artist never passes. Auto-accept requires both names to match
    after normalization and no second candidate close behind with a
    *different* title (several exact duplicates, e.g. re-uploads, are fine).
    """
    scored = sorted(((min(similarity(artist, a), similarity(album, t)), i, t, similarity(artist, a))
                     for i, (a, t) in enumerate(candidates)), reverse=True)
    if not scored or scored[0][0] < REVIEW:
        return Decision("not_found", round(scored[0][0], 3) if scored else 0.0, None, "no close candidate")
    best, index, title, _ = scored[0]
    # Any other distinct release by the same artist with a related title (deluxe
    # sets, anniversary boxes, "x" vs "x part 2") sends the album to review.
    rivals = [i for _, i, t, a in scored[1:]
              if a >= ACCEPT and normalize(t) != normalize(title) and similarity(album, t) >= RIVAL]
    if best >= ACCEPT and not rivals:
        return Decision("resolved", round(best, 3), index, "exact normalized match")
    reason = "competing candidates" if rivals else "partial name match"
    return Decision("needs_review", round(best, 3), index, reason)

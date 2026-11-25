"""Verify the existing public domain serves the exact stats and Vite build."""

import argparse
import hashlib
from html.parser import HTMLParser
from pathlib import Path
import time
from urllib.request import Request, urlopen


ORIGIN = "https://fm.eduramirez.dev"
MAX_RESPONSE = 4 * 1024 * 1024
# Cloudflare's bot protection answers 403 to the default "Python-urllib" agent.
USER_AGENT = "lastfm-data-platform-publication-check/1.0 (+https://github.com/deadour/lastfm-data-platform)"


def fetch(path: str) -> tuple[bytes, str]:
    request = Request(ORIGIN + path, headers={
        "Cache-Control": "no-cache", "Accept-Encoding": "identity", "User-Agent": USER_AGENT,
    })
    with urlopen(request, timeout=20) as response:
        content = response.read(MAX_RESPONSE + 1)
        if len(content) > MAX_RESPONSE:
            raise ValueError("Public response exceeded the verification limit")
        return content, response.headers.get("Content-Type", "")


class Modules(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        src = attributes.get("src", "")
        if tag == "script" and attributes.get("type") == "module" and src.startswith("/assets/") and src.endswith(".js"):
            self.paths.append(src)


def verify(expected: Path, index: Path, *, fetcher=fetch) -> None:
    content = expected.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    remote, content_type = fetcher(f"/data/stats.json?v={digest}")
    if "json" not in content_type.lower() or hashlib.sha256(remote).hexdigest() != digest:
        raise ValueError("The public domain does not serve the expected stats.json")
    modules = Modules()
    modules.feed(index.read_text(encoding="utf-8"))
    if not modules.paths:
        raise ValueError("The deployment must contain a compiled Vite build")
    html, content_type = fetcher(f"/?v={digest}")
    if "html" not in content_type.lower():
        raise ValueError("The public domain did not return the application HTML")
    for path in modules.paths:
        if path not in html.decode("utf-8"):
            raise ValueError("The public domain serves a different frontend build")
        local = (index.parent / path.lstrip("/")).resolve()
        if not local.is_relative_to(index.parent.resolve()):
            raise ValueError("Invalid Vite asset path")
        remote, content_type = fetcher(path)
        if "javascript" not in content_type.lower() or hashlib.sha256(remote).digest() != hashlib.sha256(local.read_bytes()).digest():
            raise ValueError("The public domain did not serve the compiled frontend asset")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify real statistics and the complete build on fm.eduramirez.dev")
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    args = parser.parse_args(argv)
    for attempt in range(6):
        try:
            verify(args.expected, args.index)
            print("Verified real stats and the compiled frontend on fm.eduramirez.dev; automatic publishing remains unchanged")
            return 0
        except Exception:
            # Never echo a response body containing private or unexpected data.
            if attempt < 5:
                time.sleep(10)
    print("Public verification failed; inspect the deployment, domain association and cache. Automatic publishing must remain disabled.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

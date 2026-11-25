from io import BytesIO
import json
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

from src.jobs import check_pages, verify_publication


def project(**changes):
    return {"name": "lastfm-data-platform", "production_branch": "main", "source": {"config": {
        "production_deployments_enabled": False, "preview_deployment_setting": "none"}}, **changes}


@pytest.mark.parametrize("payload", [project(), project(source=None)])
def test_safe_ownership_passes(payload):
    check_pages.check_project(payload)


@pytest.mark.parametrize("payload", [
    project(name="a-new-project"), project(production_branch="feature/frontend"),
    project(source={"config": {"production_deployments_enabled": True, "preview_deployment_setting": "none"}}),
    project(source={"config": {"production_deployments_enabled": False, "preview_deployment_setting": "all"}}),
    project(source={"config": {}}), project(source="invalid"),
])
def test_deployment_is_blocked_until_ownership_is_explicit(payload):
    with pytest.raises(check_pages.PublicationBlocked):
        check_pages.check_project(payload)


def test_cloudflare_check_is_get_only_and_keeps_credentials_out_of_output(capsys):
    calls = []
    def opener(request, timeout):
        calls.append(request)
        return BytesIO(json.dumps({"success": True, "result": project()}).encode())
    check_pages.verify_account("a" * 32, "secret-token", opener=opener)
    assert len(calls) == 1 and calls[0].get_method() == "GET"
    assert calls[0].full_url.endswith("/pages/projects/lastfm-data-platform")
    assert calls[0].get_header("Authorization") == "Bearer secret-token"
    assert "secret-token" not in capsys.readouterr().out


@pytest.mark.parametrize("error", [HTTPError("url", 403, "SECRET", {}, None), URLError("SECRET"), ValueError("SECRET")])
def test_cloudflare_errors_are_actionable_without_response_or_secret_output(error):
    def fail(*args, **kwargs):
        raise error
    with pytest.raises(check_pages.PublicationBlocked) as caught:
        check_pages.verify_account("a" * 32, "secret-token", opener=fail)
    assert "SECRET" not in str(caught.value) and "secret-token" not in str(caught.value)


def test_missing_token_blocks_before_network():
    def network(*args, **kwargs):
        pytest.fail("No network request should be made without a configured token")
    with pytest.raises(check_pages.PublicationBlocked, match="CLOUDFLARE_PAGES_API_TOKEN"):
        check_pages.verify_account("a" * 32, "", opener=network)


@pytest.fixture
def build(tmp_path):
    stats = tmp_path / "data/stats.json"
    stats.parent.mkdir()
    stats.write_bytes(b'{"source":"gold"}')
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets/app.js").write_bytes(b"compiled application")
    index = tmp_path / "index.html"
    index.write_text('<script type="module" src="/assets/app.js"></script>')
    return stats, index


def test_public_verification_matches_stats_index_and_compiled_assets(build):
    stats, index = build
    def fetch(path):
        if path.startswith("/data/"):
            assert "?v=" in path
            return stats.read_bytes(), "application/json"
        if path.startswith("/?"):
            return index.read_bytes(), "text/html"
        return (index.parent / path.lstrip("/")).read_bytes(), "application/javascript"
    verify_publication.verify(stats, index, fetcher=fetch)


@pytest.mark.parametrize("problem", ["html_fallback", "old_stats", "old_index", "missing_asset", "raw_source"])
def test_public_verification_rejects_incomplete_or_stale_deployments(build, problem):
    stats, index = build
    if problem == "raw_source":
        index.write_text('<script type="module" src="/src/main.tsx"></script>')
    def fetch(path):
        if path.startswith("/data/"):
            if problem == "html_fallback":
                return b"<html>fallback</html>", "text/html"
            return (b"old" if problem == "old_stats" else stats.read_bytes()), "application/json"
        if path.startswith("/?"):
            return (b"old" if problem == "old_index" else index.read_bytes()), "text/html"
        return b"wrong" if problem == "missing_asset" else b"compiled application", "application/javascript"
    with pytest.raises(ValueError):
        verify_publication.verify(stats, index, fetcher=fetch)


def test_public_fetch_identifies_itself(monkeypatch):
    # Cloudflare's bot protection rejects the default Python-urllib agent with 403.
    seen = {}

    class Response:
        headers = {"Content-Type": "application/json"}

        def read(self, limit):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def opener(request, timeout):
        seen.update(request.header_items())
        return Response()

    monkeypatch.setattr(verify_publication, "urlopen", opener)
    verify_publication.fetch("/data/stats.json")
    agent = {k.lower(): v for k, v in seen.items()}["user-agent"]
    assert agent.startswith("lastfm-data-platform-publication-check/") and "Python-urllib" not in agent

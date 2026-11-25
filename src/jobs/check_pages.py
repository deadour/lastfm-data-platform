"""Read-only deployment ownership check for the existing Pages project."""

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT = "lastfm-data-platform"


class PublicationBlocked(ValueError):
    """A safe-to-log configuration problem; never includes API response bodies."""


def check_project(project: dict) -> None:
    if project.get("name") != PROJECT:
        raise PublicationBlocked("The API response does not identify the existing lastfm-data-platform project")
    if project.get("production_branch") != "main":
        raise PublicationBlocked("Set the existing Pages production branch to main before publishing")
    source = project.get("source")
    if source is not None:
        if not isinstance(source, dict) or not isinstance(source.get("config"), dict):
            raise PublicationBlocked("Cloudflare did not return verifiable Git deployment controls")
        config = source.get("config", {})
        if (config.get("production_deployments_enabled") is not False
                or config.get("preview_deployment_setting") != "none"):
            raise PublicationBlocked("Disable automatic production Git deployments and set preview branches to None before publishing")


def verify_account(account: str, token: str, *, opener=urlopen) -> None:
    if not re.fullmatch(r"[a-f0-9]{32}", account):
        raise PublicationBlocked("Configure CLOUDFLARE_ACCOUNT_ID with the account's 32-character ID")
    if not token:
        raise PublicationBlocked("Configure the environment secret CLOUDFLARE_PAGES_API_TOKEN with a scoped Pages Edit token")
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{PROJECT}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with opener(request, timeout=20) as response:
            body = json.load(response)
        if body.get("success") is not True or not isinstance(body.get("result"), dict):
            raise PublicationBlocked("Cloudflare could not verify the existing Pages project")
        check_project(body["result"])
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise PublicationBlocked("Cloudflare rejected the token; check Pages Edit permission and the selected account") from None
        raise PublicationBlocked("Cloudflare project lookup failed; check account access and the existing project") from None
    except (URLError, TimeoutError, ValueError) as exc:
        if isinstance(exc, PublicationBlocked):
            raise
        raise PublicationBlocked("Cloudflare project lookup was unavailable or invalid; retry without changing deployment settings") from None


def main() -> int:
    try:
        verify_account(os.getenv("CLOUDFLARE_ACCOUNT_ID", ""), os.getenv("CLOUDFLARE_PAGES_API_TOKEN", ""))
    except PublicationBlocked as exc:
        print(str(exc))
        return 1
    print(f"Deployment ownership verified for {PROJECT}; no settings changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

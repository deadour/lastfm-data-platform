"""Entra-authenticated file transfers to one Azure Blob container."""

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import tempfile
from typing import Iterator

from azure.identity import DefaultAzureCredential
from azure.storage.blob import ContainerClient, ContentSettings
from dotenv import load_dotenv


def normalize_blob_name(value: str) -> str:
    """Accept relative object paths, including Windows separators, without traversal."""
    name = value.replace("\\", "/")
    if (not name or len(name) > 1024 or name != name.strip()
            or any(part in {"", ".", ".."} for part in name.split("/"))
            or any(char in name for char in ":?#%")
            or any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise ValueError("Blob names must be relative paths without empty, dot or parent segments, URLs or query strings")
    return name


@dataclass(frozen=True)
class AzureSettings:
    account: str
    container: str = "lake"
    prefix: str = "bronze"

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z0-9]{3,24}", self.account):
            raise ValueError("AZURE_STORAGE_ACCOUNT must contain 3–24 lowercase letters or digits; use the account name, not a key")
        if (not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", self.container)
                or "--" in self.container):
            raise ValueError("AZURE_STORAGE_CONTAINER must be a valid 3–63 character container name")
        object.__setattr__(self, "prefix", normalize_blob_name(self.prefix))

    @property
    def account_url(self) -> str:
        return f"https://{self.account}.blob.core.windows.net"


def load_settings(env_file: str | Path | None = None, *, account: str | None = None,
                  container: str | None = None, prefix: str | None = None) -> AzureSettings:
    """Read Azure settings only when the optional Azure workflow is invoked."""
    load_dotenv(dotenv_path=env_file) if env_file is not None else load_dotenv()
    return AzureSettings(
        account=account if account is not None else os.getenv("AZURE_STORAGE_ACCOUNT", "").strip(),
        container=container if container is not None else os.getenv("AZURE_STORAGE_CONTAINER", "lake").strip(),
        prefix=prefix if prefix is not None else os.getenv("AZURE_STORAGE_PREFIX", "bronze").strip(),
    )


def sha256_file(path: str | Path) -> str:
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class AzureStorage:
    """Stream files without creating containers or changing pipeline state.

    SDK exceptions are preserved so callers can distinguish conflicts, access
    failures and transient service errors. Clients and credentials are lazy.
    """

    def __init__(self, settings: AzureSettings, *, container_client=None):
        self.settings = settings
        self._client = container_client
        self._credential = None
        self._owns_client = container_client is None

    @property
    def client(self):
        if self._client is None:
            self._credential = DefaultAzureCredential()
            self._client = ContainerClient(
                account_url=self.settings.account_url,
                container_name=self.settings.container,
                credential=self._credential,
            )
        return self._client

    def close(self) -> None:
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None
        if self._credential is not None:
            self._credential.close()
            self._credential = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def upload_file(self, local_path: str | Path, blob_name: str, *, overwrite: bool = False) -> None:
        name = normalize_blob_name(blob_name)
        content_type = "application/json" if Path(local_path).suffix.lower() == ".json" else "application/octet-stream"
        # Open before constructing a client: local errors must not cause requests.
        with Path(local_path).open("rb") as stream:
            self.client.upload_blob(
                name=name, data=stream, overwrite=overwrite,
                content_settings=ContentSettings(content_type=content_type),
            )

    def download_file(self, blob_name: str, local_path: str | Path, *, overwrite: bool = False) -> Path:
        name = normalize_blob_name(blob_name)
        target = Path(local_path)
        if target.exists() and not overwrite:
            raise FileExistsError(f"Local destination already exists: {target}")
        # Stage beside the target. A failed transfer must not truncate an old copy
        # or leave an incomplete file at the requested destination.
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            staged = Path(stream.name)
            try:
                self.client.download_blob(name).readinto(stream)
            except BaseException:
                stream.close()
                staged.unlink(missing_ok=True)
                raise
        try:
            if overwrite:
                staged.replace(target)
            else:
                # An atomic no-clobber publication, including concurrent writers.
                os.link(staged, target)
        finally:
            staged.unlink(missing_ok=True)
        return target

    def list_blobs(self, prefix: str | None = None) -> Iterator[str]:
        directory = normalize_blob_name(prefix if prefix is not None else self.settings.prefix)
        for blob in self.client.list_blobs(name_starts_with=directory + "/"):
            yield blob.name

    def verify_file(self, local_path: str | Path, blob_name: str) -> str:
        original = sha256_file(local_path)
        with tempfile.TemporaryDirectory(prefix="lastfm-verify-") as directory:
            downloaded = self.download_file(blob_name, Path(directory) / "download.json")
            if sha256_file(downloaded) != original:
                raise ValueError("SHA-256 mismatch: remote content differs from the local file")
        return original

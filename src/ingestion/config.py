"""Configuration for the Last.fm ingestion pipeline."""

from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


class ConfigurationError(ValueError):
    """Raised when required ingestion configuration is missing."""


@dataclass(frozen=True)
class Settings:
    api_key: str
    username: str
    shared_secret: str | None = None


def load_settings(env_file: str | Path | None = None) -> Settings:
    """Load settings from environment variables and an optional dotenv file."""
    if env_file is None:
        load_dotenv()
    else:
        load_dotenv(dotenv_path=env_file)

    api_key = os.getenv("LASTFM_API_KEY", "").strip()
    username = os.getenv("LASTFM_USERNAME", "").strip()
    shared_secret = os.getenv("LASTFM_SHARED_SECRET", "").strip() or None
    missing = [name for name, value in (("LASTFM_API_KEY", api_key), ("LASTFM_USERNAME", username)) if not value]
    if missing:
        raise ConfigurationError(f"Missing required configuration: {', '.join(missing)}")
    return Settings(api_key=api_key, username=username, shared_secret=shared_secret)

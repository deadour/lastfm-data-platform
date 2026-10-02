import pytest

from src.ingestion.config import ConfigurationError, load_settings


def test_missing_required_configuration(tmp_path, monkeypatch):
    monkeypatch.delenv("LASTFM_API_KEY", raising=False)
    monkeypatch.delenv("LASTFM_USERNAME", raising=False)
    with pytest.raises(ConfigurationError, match="LASTFM_API_KEY"):
        load_settings(tmp_path / "missing.env")


def test_loads_configuration_without_exposing_values(tmp_path, monkeypatch):
    monkeypatch.delenv("LASTFM_API_KEY", raising=False)
    monkeypatch.delenv("LASTFM_USERNAME", raising=False)
    monkeypatch.delenv("LASTFM_SHARED_SECRET", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("LASTFM_API_KEY=key\nLASTFM_USERNAME=user\nLASTFM_SHARED_SECRET=secret\n", encoding="utf-8")
    settings = load_settings(env_file)
    assert settings.api_key == "key"
    assert settings.username == "user"
    assert settings.shared_secret == "secret"

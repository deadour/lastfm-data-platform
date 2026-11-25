from unittest.mock import MagicMock

from azure.core.exceptions import ClientAuthenticationError, HttpResponseError, ResourceExistsError, ServiceRequestError
import pytest

from src.storage import azure_cli


@pytest.fixture
def source(tmp_path, monkeypatch):
    root = tmp_path / "bronze"
    path = root / "lastfm" / "recent_tracks" / "ingestion_date=2026-10-02" / "run_20261002T214613Z" / "page_0001.json"
    path.parent.mkdir(parents=True)
    path.write_bytes(b'{"payload": {}}\r\n')
    monkeypatch.setattr(azure_cli, "BRONZE_ROOT", root)
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "stlastfmedu")
    monkeypatch.setenv("AZURE_STORAGE_CONTAINER", "lake")
    monkeypatch.setenv("AZURE_STORAGE_PREFIX", "bronze")
    return path


@pytest.fixture
def factory(monkeypatch):
    factory = MagicMock()
    monkeypatch.setattr(azure_cli, "AzureStorage", factory)
    return factory


def test_dry_run_never_constructs_client(source, factory, capsys):
    before = source.read_bytes()
    assert azure_cli.main(["upload-bronze", "--file", str(source), "--dry-run", "--verify"]) == 0
    factory.assert_not_called()
    assert source.read_bytes() == before
    output = capsys.readouterr().out
    assert "https://stlastfmedu.blob.core.windows.net/lake/bronze/lastfm/recent_tracks/" in output
    assert "Overwrite: False" in output


@pytest.mark.parametrize("overwrite", [False, True])
def test_upload_maps_existing_partition_and_verifies(source, factory, overwrite):
    args = ["upload-bronze", "--file", str(source), "--verify"]
    if overwrite:
        args.append("--overwrite")
    assert azure_cli.main(args) == 0
    storage = factory.return_value.__enter__.return_value
    name = "bronze/" + source.relative_to(azure_cli.BRONZE_ROOT).as_posix()
    storage.upload_file.assert_called_once_with(source, name, overwrite=overwrite)
    storage.verify_file.assert_called_once_with(source, name)


@pytest.mark.parametrize("name", ["metadata/azure-test.json", "bronze/../metadata/a.json", "/bronze/a.json"])
def test_rejects_out_of_scope_blob(source, factory, name):
    assert azure_cli.main(["upload-bronze", "--file", str(source), "--blob-name", name]) == 1
    factory.assert_not_called()


def test_rejects_secrets_and_missing_files(source, factory):
    secret = source.parents[5] / ".env"
    secret.write_text("not-for-upload")
    assert azure_cli.main(["upload-bronze", "--file", str(secret)]) == 1
    outside = secret.with_suffix(".json")
    outside.write_text("{}")
    assert azure_cli.main(["upload-bronze", "--file", str(outside)]) == 1
    assert azure_cli.main(["upload-bronze", "--file", str(source.with_name("missing.json"))]) == 1
    factory.assert_not_called()


def test_explicit_config_overrides_environment(source, factory):
    assert azure_cli.main(["--account", "differentlake", "--container", "test-lake", "--prefix", "test-bronze", "upload-bronze", "--file", str(source), "--dry-run"]) == 0
    factory.assert_not_called()


def test_list_download_and_verify(source, factory, capsys):
    storage = factory.return_value.__enter__.return_value
    storage.list_blobs.return_value = ["bronze/a.json"]
    assert azure_cli.main(["list", "--path-prefix", "bronze/lastfm"]) == 0
    storage.list_blobs.assert_called_once_with("bronze/lastfm")
    assert "bronze/a.json" in capsys.readouterr().out
    assert azure_cli.main(["download", "--blob-name", "bronze/a.json", "--file", "copy.json"]) == 0
    storage.download_file.assert_called_once_with("bronze/a.json", "copy.json", overwrite=False)
    assert azure_cli.main(["verify", "--file", str(source), "--blob-name", "bronze/a.json"]) == 0
    storage.verify_file.assert_called_once_with(source, "bronze/a.json")
    storage.upload_file.assert_not_called()


def http_error(status):
    error = HttpResponseError()
    error.status_code = status
    return error


@pytest.mark.parametrize("error, expected", [
    (ResourceExistsError(), "already exists"),
    (ClientAuthenticationError(), "az login"),
    (http_error(403), "Storage Blob Data Contributor"),
    (http_error(404), "not found"),
    (ServiceRequestError("SECRET sentinel"), "connectivity"),
])
def test_actionable_errors_without_credential_output(source, factory, capsys, error, expected):
    factory.return_value.__enter__.return_value.upload_file.side_effect = error
    assert azure_cli.main(["upload-bronze", "--file", str(source)]) == 1
    stderr = capsys.readouterr().err
    assert expected in stderr
    assert "SECRET" not in stderr


def test_debug_preserves_traceback(source, factory):
    factory.return_value.__enter__.return_value.upload_file.side_effect = ServiceRequestError("offline")
    with pytest.raises(ServiceRequestError):
        azure_cli.main(["--debug", "upload-bronze", "--file", str(source)])

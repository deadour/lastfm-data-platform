from types import SimpleNamespace
from unittest.mock import Mock

from azure.core.exceptions import ClientAuthenticationError, HttpResponseError, ResourceExistsError, ServiceRequestError
import pytest

from src.storage.azure import AzureSettings, AzureStorage, load_settings, normalize_blob_name, sha256_file


@pytest.fixture
def storage():
    client = Mock()
    return AzureStorage(AzureSettings("stlastfmedu"), container_client=client)


@pytest.mark.parametrize("name", ["", "/bronze/a.json", "../a", "bronze/../a", "bronze/./a", "bronze//a", "C:\\a", "a/", "a?token=x", "a#x", "a%2fb", "a\x00b", " a", "a" * 1025])
def test_invalid_blob_names(name):
    with pytest.raises(ValueError):
        normalize_blob_name(name)


def test_windows_blob_name():
    assert normalize_blob_name(r"bronze\lastfm\page_0001.json") == "bronze/lastfm/page_0001.json"


@pytest.mark.parametrize("kwargs", [{"account": "https://example.com"}, {"account": "abc", "container": "Lake"}, {"account": "abc", "container": "a--b"}, {"account": "abc", "prefix": "../silver"}])
def test_invalid_settings(kwargs):
    with pytest.raises(ValueError):
        AzureSettings(**kwargs)


def test_environment_settings(tmp_path, monkeypatch):
    for name in ("AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER", "AZURE_STORAGE_PREFIX"):
        monkeypatch.delenv(name, raising=False)
    env = tmp_path / "azure.env"
    env.write_text("AZURE_STORAGE_ACCOUNT=anotherlake\nAZURE_STORAGE_CONTAINER=private\nAZURE_STORAGE_PREFIX=bronze/test\n")
    settings = load_settings(env)
    assert settings.account_url == "https://anotherlake.blob.core.windows.net"
    assert (settings.container, settings.prefix) == ("private", "bronze/test")


@pytest.mark.parametrize("overwrite", [False, True])
def test_upload_streams_original_bytes(tmp_path, storage, overwrite):
    source = tmp_path / "page.json"
    raw = b'{ "payload": "caf\xc3\xa9" }\r\n'
    source.write_bytes(raw)
    received = []
    storage.client.upload_blob.side_effect = lambda **kw: received.append((kw, kw["data"].read()))
    options = {"overwrite": True} if overwrite else {}
    storage.upload_file(source, r"bronze\page.json", **options)
    kwargs, content = received[0]
    assert content == raw
    assert kwargs["name"] == "bronze/page.json"
    assert kwargs["overwrite"] is overwrite
    assert kwargs["content_settings"].content_type == "application/json"


def test_missing_file_does_not_connect(tmp_path, storage):
    with pytest.raises(FileNotFoundError):
        storage.upload_file(tmp_path / "missing.json", "bronze/page.json")
    storage.client.upload_blob.assert_not_called()


def test_local_permission_error_does_not_connect(tmp_path, storage, monkeypatch):
    from pathlib import Path
    monkeypatch.setattr(Path, "open", Mock(side_effect=PermissionError("denied")))
    with pytest.raises(PermissionError):
        storage.upload_file(tmp_path / "page.json", "bronze/page.json")
    storage.client.upload_blob.assert_not_called()


@pytest.mark.parametrize("error", [ResourceExistsError(), ClientAuthenticationError(), HttpResponseError(), ServiceRequestError("offline")])
def test_upload_preserves_sdk_errors(tmp_path, storage, error):
    source = tmp_path / "page.json"
    source.write_bytes(b"{}")
    storage.client.upload_blob.side_effect = error
    with pytest.raises(type(error)):
        storage.upload_file(source, "bronze/page.json")


def test_download_and_no_clobber(tmp_path, storage):
    target = tmp_path / "page.json"
    raw = b'{"a":1}\r\n'
    storage.client.download_blob.return_value.readinto.side_effect = lambda stream: stream.write(raw)
    storage.download_file("bronze/page.json", target)
    assert target.read_bytes() == raw
    storage.client.download_blob.assert_called_once_with("bronze/page.json")
    with pytest.raises(FileExistsError):
        storage.download_file("bronze/page.json", target)
    storage.client.download_blob.assert_called_once()
    storage.download_file("bronze/page.json", target, overwrite=True)
    assert target.read_bytes() == raw


def test_failed_download_preserves_existing_file(tmp_path, storage):
    target = tmp_path / "page.json"
    target.write_bytes(b"original")
    def fail(stream):
        stream.write(b"partial")
        raise ServiceRequestError("offline")
    storage.client.download_blob.return_value.readinto.side_effect = fail
    with pytest.raises(ServiceRequestError):
        storage.download_file("bronze/page.json", target, overwrite=True)
    assert target.read_bytes() == b"original"
    assert list(tmp_path.iterdir()) == [target]


def test_download_does_not_replace_a_concurrent_writer(tmp_path, storage):
    target = tmp_path / "page.json"
    def receive(stream):
        stream.write(b"downloaded")
        target.write_bytes(b"concurrent writer")
    storage.client.download_blob.return_value.readinto.side_effect = receive
    with pytest.raises(FileExistsError):
        storage.download_file("bronze/page.json", target)
    assert target.read_bytes() == b"concurrent writer"
    assert list(tmp_path.iterdir()) == [target]


def test_list_uses_directory_prefix(storage):
    storage.client.list_blobs.return_value = [SimpleNamespace(name="bronze/a.json")]
    assert list(storage.list_blobs()) == ["bronze/a.json"]
    storage.client.list_blobs.assert_called_once_with(name_starts_with="bronze/")
    list(storage.list_blobs(r"bronze\lastfm"))
    storage.client.list_blobs.assert_called_with(name_starts_with="bronze/lastfm/")


def test_verify_content_hash(tmp_path, storage):
    source = tmp_path / "page.json"
    source.write_bytes(b"{}\n")
    storage.client.download_blob.return_value.readinto.side_effect = lambda stream: stream.write(b"{}\n")
    assert storage.verify_file(source, "bronze/page.json") == sha256_file(source)
    storage.client.download_blob.return_value.readinto.side_effect = lambda stream: stream.write(b"{}")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        storage.verify_file(source, "bronze/page.json")


def test_lazy_client_lifecycle(monkeypatch):
    credential = Mock()
    client = Mock()
    credential_factory = Mock(return_value=credential)
    client_factory = Mock(return_value=client)
    monkeypatch.setattr("src.storage.azure.DefaultAzureCredential", credential_factory)
    monkeypatch.setattr("src.storage.azure.ContainerClient", client_factory)
    with AzureStorage(AzureSettings("stlastfmedu")) as storage:
        credential_factory.assert_not_called()
        assert storage.client is client
        assert storage.client is client
    credential_factory.assert_called_once_with()
    client_factory.assert_called_once_with(account_url="https://stlastfmedu.blob.core.windows.net", container_name="lake", credential=credential)
    client.close.assert_called_once()
    credential.close.assert_called_once()

"""Explicit Azure operations for existing local Bronze, Silver/Gold and state files."""

import argparse
from pathlib import Path
import sys

from azure.core.exceptions import AzureError, ClientAuthenticationError, HttpResponseError, ResourceExistsError

from .azure import AzureStorage, load_settings, normalize_blob_name
from .publish import LAYERS, build_state_snapshot, discover_artifacts, publish, upload_state_snapshot


BRONZE_ROOT = Path(__file__).resolve().parents[2] / "data" / "bronze"
LISTABLE_ROOTS = ("bronze", "silver", "gold", "gold_enriched", "metadata/state_backups")


def bronze_source(value: str) -> tuple[Path, Path]:
    source = Path(value).resolve(strict=True)
    if not source.is_file() or source.suffix.lower() != ".json":
        raise ValueError("--file must be an existing Bronze JSON file")
    if not source.is_relative_to(BRONZE_ROOT.resolve()):
        raise ValueError("--file must be inside data/bronze; secrets and other project files cannot be uploaded")
    with source.open("rb"):
        pass
    return source, source.relative_to(BRONZE_ROOT.resolve())


def scoped_name(value: str, prefix: str) -> str:
    name = normalize_blob_name(value)
    if not name.startswith(prefix + "/"):
        raise ValueError(f"Blob name must be beneath the configured prefix: {prefix}/")
    return name


def error_hint(exc: AzureError) -> str:
    if isinstance(exc, ResourceExistsError):
        return "Blob already exists. Verify the existing copy or use --overwrite deliberately."
    if isinstance(exc, ClientAuthenticationError) or getattr(exc, "status_code", None) == 401:
        return "Azure authentication failed. Run az login with the intended Entra account."
    if isinstance(exc, HttpResponseError):
        if exc.status_code == 403:
            return "Azure denied access. Check Storage Blob Data Contributor, RBAC propagation and storage network rules."
        if exc.status_code == 404:
            return "Container or blob not found. Check the configured account, container and blob name."
    return "Azure request failed. Check connectivity and service availability before retrying."


def extended_command(args) -> int:
    """Silver/Gold publication and state backup; names are derived, never free-form."""
    if args.command == "publish-layer":
        artifacts = discover_artifacts(args.layer, args.path)
        if args.dry_run:
            for item in artifacts:
                print(f"Dry run: {item.source} ({item.size} bytes) -> {item.blob_name}")
            print(f"{len(artifacts)} files, {sum(item.size for item in artifacts)} bytes. "
                  f"Overwrite: {args.overwrite}. No Azure connection or writes performed.")
            return 0
    elif args.command == "backup-state":
        snapshot = build_state_snapshot()
        for item in snapshot.artifacts:
            print(f"{'Dry run: ' if args.dry_run else ''}{item.source.name} ({item.size} bytes) -> {item.blob_name}")
        for item in snapshot.manifest["skipped"]:
            print(f"Skipped unreadable: {item['path']} ({item['reason']})")
        print(f"Completed runs: {snapshot.manifest['completed_runs']}; "
              f"completed watermark: {snapshot.manifest['completed_watermark_uts']}")
        if args.dry_run:
            print("No Azure connection or writes performed; local state unchanged.")
            return 0
        if not args.confirm:
            raise ValueError("backup-state uploads personal listening metadata; review the dry run and pass --confirm")
    else:
        prefix = normalize_blob_name(args.path_prefix)
        if not any(prefix == root or prefix.startswith(root + "/") for root in LISTABLE_ROOTS):
            raise ValueError(f"--path-prefix must be beneath one of: {', '.join(LISTABLE_ROOTS)}")
    settings = load_settings(account=args.account, container=args.container, prefix=args.prefix)
    with AzureStorage(settings) as storage:
        if args.command == "publish-layer":
            outcomes = [publish(storage, item, overwrite=args.overwrite, verify=args.verify) for item in artifacts]
            print(f"Done: {len(outcomes)} files; " + ", ".join(f"{name}={outcomes.count(name)}" for name in sorted(set(outcomes))))
        elif args.command == "backup-state":
            print(f"State backup manifest: {upload_state_snapshot(storage, snapshot, verify=args.verify)}")
        else:
            count = total = 0
            for name, size in storage.list_files(prefix):
                print(f"{size:>12}  {name}")
                count, total = count + 1, total + size
            print(f"{count} data files, {total} bytes (directory entries excluded)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Transfer existing Bronze files to Azure; local ingestion remains independent")
    parser.add_argument("--account", help="Override AZURE_STORAGE_ACCOUNT")
    parser.add_argument("--container", help="Override AZURE_STORAGE_CONTAINER (default: lake)")
    parser.add_argument("--prefix", help="Override AZURE_STORAGE_PREFIX (default: bronze)")
    parser.add_argument("--debug", action="store_true", help="Preserve the exception traceback on failure")
    commands = parser.add_subparsers(dest="command", required=True)
    upload = commands.add_parser("upload-bronze", help="Upload one explicit JSON file under data/bronze")
    upload.add_argument("--file", required=True)
    upload.add_argument("--blob-name", help="Default: prefix plus the file path relative to data/bronze")
    upload.add_argument("--dry-run", action="store_true")
    upload.add_argument("--overwrite", action="store_true")
    upload.add_argument("--verify", action="store_true", help="Download after upload and compare SHA-256")
    listing = commands.add_parser("list", help="List objects beneath the configured prefix")
    listing.add_argument("--path-prefix", help="Optional subdirectory beneath the configured prefix")
    download = commands.add_parser("download", help="Download one object without clobbering local files")
    download.add_argument("--blob-name", required=True)
    download.add_argument("--file", required=True, help="Destination; parent directory must exist")
    download.add_argument("--overwrite", action="store_true")
    verify = commands.add_parser("verify", help="Compare an existing Bronze file with an existing blob")
    verify.add_argument("--file", required=True)
    verify.add_argument("--blob-name", help="Default: prefix plus the file path relative to data/bronze")
    layer = commands.add_parser("publish-layer", help="Upload a local Silver or Gold snapshot without overwriting")
    layer.add_argument("--layer", required=True, choices=sorted(LAYERS))
    layer.add_argument("--path", help="One file or subdirectory inside the layer (default: whole layer)")
    layer.add_argument("--dry-run", action="store_true")
    layer.add_argument("--overwrite", action="store_true", help="Replace remote objects whose bytes differ")
    layer.add_argument("--verify", action="store_true", help="Stream remote bytes and compare SHA-256")
    files = commands.add_parser("list-files", help="List data files (no directory entries) with sizes")
    files.add_argument("--path-prefix", required=True, help=f"Beneath one of: {', '.join(LISTABLE_ROOTS)}")
    state = commands.add_parser("backup-state", help="Upload an immutable, non-authoritative state snapshot")
    state.add_argument("--dry-run", action="store_true")
    state.add_argument("--verify", action="store_true")
    state.add_argument("--confirm", action="store_true",
                       help="Required for upload: run metadata describes personal listening activity")
    args = parser.parse_args(argv)

    try:
        if args.command in {"publish-layer", "list-files", "backup-state"}:
            return extended_command(args)
        settings = load_settings(account=args.account, container=args.container, prefix=args.prefix)

        if args.command in {"upload-bronze", "verify"}:
            source, relative = bronze_source(args.file)
            name = scoped_name(args.blob_name or f"{settings.prefix}/{relative.as_posix()}", settings.prefix)
            if args.command == "upload-bronze" and args.dry_run:
                print(f"Dry run: {source} ({source.stat().st_size} bytes)")
                print(f"Destination: {settings.account_url}/{settings.container}/{name}")
                print(f"Overwrite: {args.overwrite}. No Azure connection or writes performed.")
                return 0
        elif args.command == "download":
            name = scoped_name(args.blob_name, settings.prefix)
        else:
            directory = settings.prefix
            if args.path_prefix:
                directory = scoped_name(args.path_prefix, settings.prefix)

        with AzureStorage(settings) as storage:
            if args.command == "upload-bronze":
                storage.upload_file(source, name, overwrite=args.overwrite)
                print(f"Uploaded: {settings.container}/{name}")
                if args.verify:
                    print(f"SHA-256 verified: {storage.verify_file(source, name)}")
            elif args.command == "list":
                for name in storage.list_blobs(directory):
                    print(name)
            elif args.command == "download":
                print(f"Downloaded: {storage.download_file(name, args.file, overwrite=args.overwrite)}")
            else:
                print(f"SHA-256 verified: {storage.verify_file(source, name)}")
        return 0
    except (AzureError, OSError, ValueError) as exc:
        message = error_hint(exc) if isinstance(exc, AzureError) else str(exc)
        print(f"{message} Use --debug before the command for a traceback.", file=sys.stderr)
        if args.debug:
            raise
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

# Azure Data Lake: Bronze file transfers

Phase 6A adds an explicit file-transfer command alongside the local pipeline.
It uses the Blob SDK against an existing ADLS Gen2 account; no native directory
operations are needed for this phase.

```text
Last.fm API → local Bronze JSON → optional upload → lake/bronze/…
                   │
                   └→ local Silver → Gold / enrichment → local dashboard
```

The project owner has already created these resources and verified
upload/list/download in Cloud Shell using `metadata/azure-test.json`:

| Resource | Value |
| --- | --- |
| Subscription | Azure for Students |
| Resource group | `rg-lastfm-dev` |
| Region | Brazil South |
| Storage account | `stlastfmedu`, hierarchical namespace enabled |
| Private container | `lake` |
| Blob endpoint | `https://stlastfmedu.blob.core.windows.net` |

The commands below do not provision resources, change access rules or operate
on `metadata/azure-test.json`. That previous Cloud Shell check is separate from
verification of this Python integration.

## Python environment

Run from the repository root. Use Python 3.12; there is no dependency on a global
Python 3.14 installation. If `.venv` already exists, activate it without recreating
it. For a new environment on Windows:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

On macOS/Linux, use `python3.12 -m venv .venv` and `source .venv/bin/activate`.
The only Azure dependencies added are `azure-identity` and `azure-storage-blob`.
The existing dependency manifest remains in use. Pandas is constrained to 2.x:
a clean install with pandas 3 produced microsecond timestamps that fail the
existing Silver nanosecond schema validation. This keeps Silver behavior intact
without changing transformations as part of the cloud integration.

Add these nonsecret settings to your existing ignored `.env`. Do not replace an
existing `.env` with the example file:

```dotenv
AZURE_STORAGE_ACCOUNT=stlastfmedu
AZURE_STORAGE_CONTAINER=lake
AZURE_STORAGE_PREFIX=bronze
```

`AZURE_STORAGE_ACCOUNT` is an account name, never an account key. Only an Azure
command reads these settings; local ingestion continues using its current
configuration. CLI `--account`, `--container` and `--prefix` override the
environment and must appear before the subcommand.

## Authentication and access

Sign in with the Entra user that has **Storage Blob Data Contributor** assigned
at storage-account scope:

```powershell
az login
az account show --output table
```

Check that the selected subscription is Azure for Students. If Windows broker
login fails, use the workaround already tested for this account:

```powershell
az config set core.enable_broker_on_windows=false
az login
```

The adapter uses `DefaultAzureCredential`: it can discover the Azure CLI login
locally and use managed identity later without changing adapter code. Managed
identity deployment is not part of this phase. No account keys, SAS URLs or
connection strings are accepted by the command. No Azure credentials are added
to GitHub Actions. See Microsoft's [passwordless Python quickstart](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-python).

A subscription management role alone does not grant blob data access. RBAC
assignments can take time to propagate; after a new assignment, wait and retry.
For 403 responses, also check storage firewall/private endpoint restrictions.
The adapter binds to one container and does not enumerate subscriptions or
create containers. The CLI confines object operations to the configured prefix.

The owner's Windows Azure CLI storage command previously crashed with
`TypeError: 'NoneType' object is not iterable` in `get_permission_help_string`.
That CLI failure does not establish that credentials or RBAC are invalid.
Cloud Shell storage commands worked; test this Python SDK path independently.
Azure CLI still needs to be available on PATH if it supplies the local login.

## Transfer and verify one existing page

This file existed in the local repository during implementation:

```text
data/bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json
```

Bronze data is ignored by Git. On another machine, substitute a real local page;
the command will not generate one or run ingestion automatically. Upload and
verification sources must resolve to JSON files inside this repository's
`data/bronze` directory. Symlinks resolving outside that directory are rejected.

Preview first; this performs no Azure client initialization, authentication,
network request or file write:

```powershell
python -m src.storage.azure_cli --account stlastfmedu upload-bronze --file data/bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json --dry-run
```

Upload and download a temporary copy for SHA-256 comparison:

```powershell
python -m src.storage.azure_cli --account stlastfmedu upload-bronze --file data/bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json --verify
```

The deterministic destination is:

```text
lake/bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json
```

Files stream as binary data with JSON content type. There is no reserialization
or timestamp conversion. Windows separators in explicit blob names become `/`;
absolute paths, empty/dot/parent segments and URL/query syntax are rejected.

`--blob-name bronze/<relative-name>.json` can override the default target.
An existing blob causes failure by default, including an identical copy.
Use `verify` on a repeat run rather than replacing it. `--overwrite` is an explicit
opt-in to replace that one remote object. If post-upload verification fails,
the upload is not rolled back or deleted; inspect and verify the existing object
before retrying. No ingestion checkpoint is changed in either case.

List the Bronze directory:

```powershell
python -m src.storage.azure_cli --account stlastfmedu list
python -m src.storage.azure_cli --account stlastfmedu list --path-prefix bronze/lastfm/recent_tracks
```

The list operation matches a directory boundary (`bronze/`), not similarly named
prefixes such as `bronze-backup/`.

Download into the ignored reports directory; the parent must already exist:

```powershell
python -m src.storage.azure_cli --account stlastfmedu download --blob-name bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json --file reports/azure-bronze-check.json
```

Downloads refuse an existing destination unless `--overwrite` is passed. They
stage the transfer beside the destination and publish it only after success.
The no-overwrite publication uses a hard link, so its destination filesystem
must support hard links (such as local NTFS or ext4).

Verify an existing blob without uploading it again:

```powershell
python -m src.storage.azure_cli --account stlastfmedu verify --file data/bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json
```

Verification downloads to a temporary directory, compares actual SHA-256 values
and removes the temporary copy. An ETag is not treated as a content hash. To
compare a manually downloaded copy in PowerShell:

```powershell
Get-FileHash data/bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json -Algorithm SHA256
Get-FileHash reports/azure-bronze-check.json -Algorithm SHA256
```

In Azure Portal, open **Storage accounts → stlastfmedu → Containers → lake →
bronze** and inspect the partition path. Keep the container private.

Commands return exit code 1 on transfer, validation or verification failures,
with an actionable message. SDK exceptions remain intact in the adapter. Add
`--debug` before the subcommand to retain the exception traceback for diagnosis;
review diagnostic output before sharing it.

## Validation

Offline tests cover path validation, streaming bytes, overwrite protection,
authentication/service failures, failed-download cleanup, prefix filtering,
SHA-256 comparison and a dry-run that never constructs an Azure client:

```powershell
python -m pytest -q tests/test_azure_storage.py tests/test_azure_cli.py -p no:cacheprovider
python -m pytest -q -p no:cacheprovider
git diff --check
```

There is no CI workflow in the current repository. Tests do not contact Azure
or Last.fm. A successful offline suite is not a live Azure smoke test; the
upload-and-verify command above is the separate live check.

## Cost and next steps

Start with one small page and check the destination before uploading more.
Stored bytes, write/list/read transactions and outbound downloads can consume
Azure for Students credit. Verification adds a read and download. Existing
storage redundancy and access tier affect charges; check the account's actual
configuration, [Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)
and Azure Cost Management. This phase creates no compute resources and adds no
schedule or background activity.

Silver/Gold persistence, checkpoint migration, Container Apps Jobs, managed
identity deployment, scheduling, GitHub Actions OIDC and a cloud dashboard remain
future work. The local pipeline and its watermark semantics are unchanged.

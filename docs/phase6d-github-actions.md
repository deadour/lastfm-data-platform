# Phase 6D — Daily run on GitHub Actions + ADLS Gen2 (prepared, not active)

This replaces the Container Apps plan in `phase6c-cloud-readiness.md`. There
is no ACR, no Log Analytics and no Container Apps: a GitHub-hosted runner
executes Python, and ADLS Gen2 (`stlastfmedu/lake`) is the only persistent
store. Azure access uses OIDC federation with Microsoft Entra ID; there are no
client secrets, account keys or SAS tokens.

**Status (2026-11-25):**
- Checkpoint seeded.
- Entra identity, OIDC federation and container-scoped role created.
- GitHub environment and variables created.
- Last.fm secrets set in the environment; the workflow is on `main` (PR #2).
- **First manual run succeeded** (see below). Checkpoint is at `sequence` 1.
- Daily schedule `17 6 * * *` (06:17 UTC) is defined in the workflow; it is active
  once this change is on `main`. Scheduled runs use `max_pages=25`.

## Resources created (2026-11-25)

| What | Identifier | Notes |
| --- | --- | --- |
| Checkpoint blob | `lake/metadata/checkpoints/lastfm_recent_tracks.json` | `sequence` 0, watermark `1790979172`, points to `silver/scrobbles/snapshot=20261002T223940Z` (hashes `54004e83…5f5a`, `63efceb1…f6af`); seed ETag `"0x8DF4B1D2ECD23BC"` |
| Entra app registration | `gh-lastfm-pipeline`, appId `8b235061-3bc6-45ef-83dd-0ad1473b583a` | single tenant; **no client secrets or certificates** |
| Service principal | objectId `40466d4b-cee5-47e3-95a7-708bb80a7f51` | |
| Federated credential | `gh-lastfm-prod-immutable` | issuer `https://token.actions.githubusercontent.com`, subject `repo:deadour@65253771/lastfm-data-platform@1402346073:environment:lastfm-prod`, audience `api://AzureADTokenExchange`. The only credential; see "OIDC subject format" |
| Role assignment | `5f7d651b-81a7-4d25-8008-6ee4368bbb41` | *Storage Blob Data Contributor* on `…/stlastfmedu/blobServices/default/containers/lake` only; the SP has no other role |
| GitHub environment | `lastfm-prod` | deployments limited to branch `main`; repo emits immutable OIDC subjects (`use_immutable_subject: true`) |
| Environment variables | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER` | identifiers, not secrets |

All of these are free. Checks performed:
- No checkpoint or lock existed before the seed.
- The seed verified remote vs local Silver bytes against the expected 6B hashes.
- A second `seed --confirm` was refused by Azure (`If-None-Match`) and the ETag
  stayed unchanged.
- The SP has 0 password/key credentials.

The first `seed --confirm` wrote the checkpoint and then crashed reading the ETag
(`ContainerClient.upload_blob` returns a client, not properties). The content was
verified correct; the adapter now uses `BlobClient.upload_blob`, which is covered by
a test and was confirmed against Azure by the refused second seed.

To undo: `az role assignment delete --ids <scope>/providers/Microsoft.Authorization/roleAssignments/5f7d651b-81a7-4d25-8008-6ee4368bbb41`, `az ad app delete --id 8b235061-3bc6-45ef-83dd-0ad1473b583a`, delete the environment in GitHub.
To cut only GitHub's access, delete the federated credential:
`az ad app federated-credential delete --id <appId> --federated-credential-id gh-lastfm-prod-immutable`.

## OIDC subject format (fix applied 2026-11-25)

The first manual run ([45673908480](https://github.com/deadour/lastfm-data-platform/actions/runs/45673908480))
failed at **Azure login** with `AADSTS700213: No matching federated identity
record found`. The pipeline step never started, so nothing was ingested or
written, and the checkpoint stayed at `sequence` 0.

- **Cause.** This repository emits OIDC subjects in GitHub's immutable format,
  `repo:<owner>@<owner_id>/<repo>@<repo_id>:environment:<env>`. Here that is
  `repo:deadour@65253771/lastfm-data-platform@1402346073:environment:lastfm-prod`.
  The federated credential had been created with the classic
  `repo:deadour/lastfm-data-platform:environment:lastfm-prod`. Entra matches
  the subject exactly.
  - The `customization/sub` API reports `use_default: true` **and**
    `use_immutable_subject: true`. The prefix to trust is its `sub_claim_prefix`,
    not the classic form.
- **Fix.**
  1. Confirmed through the GitHub API that owner id `65253771` and repo id
     `1402346073` belong to `deadour/lastfm-data-platform`.
  2. Added `gh-lastfm-prod-immutable` with that exact subject. Same app,
     environment, issuer and audience; no role change.
  3. After the successful run, deleted the classic `gh-lastfm-prod` credential.
     The successful run's token presented the immutable subject, so the
     classic credential could never match.
- **Why it is safer.** Repository and owner IDs do not change on rename. A
  repository later created with the same name cannot match the subject.
- **If the repo is renamed or transferred,** re-read `sub_claim_prefix` and
  update the credential subject.

## First successful run (2026-11-25)

Run [45674216054](https://github.com/deadour/lastfm-data-platform/actions/runs/45674216054):
`workflow_dispatch` from `main`, `max_pages=25`, conclusion **success**, all
steps green. The results below were re-checked independently by downloading
from ADLS after the run.

| Stage | Result |
| --- | --- |
| OIDC login | Token for `environment:lastfm-prod` exchanged; no secret used |
| Restore | Checkpoint `sequence` 0, watermark `1790979172`. Silver `snapshot=20261002T223940Z` restored and SHA-256 checked |
| Ingest | Run `20261125T182121Z` `completed`: 8 pages, 1 473 scrobbles read, 0 rejected |
| Bronze | `bronze/lastfm/recent_tracks/ingestion_date=2026-11-25/run_20261125T182121Z/`: 8 pages + `run_metadata.json`, 1 719 603 bytes, each SHA-256 verified |
| Silver | `silver/scrobbles/snapshot=20261125T182131Z`: **118 343 rows** |
| Gold | `gold/snapshot=20261125T182132Z`: 8 marts + `_metadata.json` |
| Duplicates | 1 boundary scrobble refetched at the watermark and removed. 1 472 net new rows (116 871 + 1 472 = 118 343); `scrobble_id` unique; no repeated (timestamp, artist, track) |
| Hashes | All 11 snapshot files referenced by the checkpoint match their recorded SHA-256 after download |
| Checkpoint | `sequence` **1**, watermark `1795606010` (2026-11-25 11:26:50 UTC), `last_run_id` `20261125T182121Z`. Lock lease released |

The previous Silver snapshot and all 6A/6B blobs are unchanged. The job log
reports `new_rows 1473` because it counts rows before deduplication.

## How one run works

`.github/workflows/daily-pipeline.yml` → `python -m src.jobs.cloud_run run --max-pages N`

1. **Lock.** Create the empty blob `metadata/checkpoints/lastfm_recent_tracks.lock`
   once, then take a 60 s lease renewed every 20 s. A second run gets 409
   and exits 5. The workflow `concurrency` group already serializes Actions
   runs; the lease also covers a run started from a laptop.
2. **Restore.** Read `metadata/checkpoints/lastfm_recent_tracks.json` (and its
   ETag). Download the Silver snapshot it names and check every file against
   the SHA-256 stored in the checkpoint. On a mismatch, stop before ingesting.
3. **Ingest** incrementally from the checkpoint watermark (`ingest(...,
   from_timestamp=...)`). The runner has no local Bronze history, so the
   watermark must come from the checkpoint.
4. **Build.**
   - Silver: incremental `transform`, which appends the new run and deduplicates
     on `scrobble_id`.
   - Gold: full `build_gold` from that Silver.
5. **Publish** with no overwrite and SHA-256 verification.
   - Bronze: the new run directory (`bronze/…/run_<id>/`).
   - Silver and Gold: new snapshots, only if there are new rows.
6. **Commit** the checkpoint with `If-Match: <etag>`. Only a `completed` run
   with all pages and a non-decreasing watermark is accepted. The new document
   points to the new snapshots and their hashes.

Exit codes: 0 committed · 2 page cap reached (partial, not committed) ·
3 run not completed · 4 no checkpoint (seed first) · 5 lock held · 1 any other
failure (checkpoint unchanged).

### Why no scrobble is lost

- The watermark only advances in step 6, after Bronze, Silver and Gold are
  durably in ADLS. Any failure earlier means the next run repeats the same
  window from the old watermark.
- Partial runs (`failed / MaxPagesLimit`) never commit (Phase 6C fix + tests).
- The window is inclusive at the boundary. The scrobble equal to the watermark
  is fetched again and removed by Silver dedup (tested).
- Raw Bronze pages are kept in ADLS even when Silver rejects malformed records,
  so a later fix can reprocess them.
- An uncommitted attempt can leave orphaned Bronze/Silver/Gold objects. They
  are harmless: they are never referenced by the checkpoint and each retry is a
  new `run_<id>`.

## Seeding the first checkpoint (done 2026-11-25)

The seed uses the Silver snapshot already verified in 6B and the watermark
from local completed runs. It checks that local and remote Silver are
byte-identical and that Silver contains every completed local run. A dry run
was executed and passed:

```text
watermark_uts 1790979172   (2026-10-02)
silver/scrobbles/snapshot=20261002T223940Z  scrobbles.parquet 54004e83…5f5a  _metadata.json 63efceb1…f6af
```

```powershell
python -m src.jobs.cloud_run --account stlastfmedu --container lake seed --silver-snapshot silver/scrobbles/snapshot=20261002T223940Z
python -m src.jobs.cloud_run --account stlastfmedu --container lake seed --silver-snapshot silver/scrobbles/snapshot=20261002T223940Z --confirm
```

`--confirm` creates the checkpoint with `If-None-Match: *`, so it can never
replace an existing one.

**First-run backlog (measured 2026-11-25).** One read-only `limit=1` call for
the window `[1790979172, now]` reported **1 473 scrobbles over 53.8 days:
8 pages of 200.**

- **Cap.** The default `max_pages=25` (5 000 scrobbles) covers the backlog with
  margin, so no special first run is needed. If a backlog ever exceeds the cap,
  every run exits 2 without committing: raise `max_pages` for one manual run.
  Do not lower the cap to "chunk" it, because partial runs never advance.
- **Pagination.** Last.fm pages are newest-first. A scrobble arriving
  mid-run would shift every later page by one. The job therefore freezes the
  window with `to = job start`. Scrobbles after that are picked up next day,
  from the committed watermark.
- **API limits.** 8–25 sequential requests per day, with retries and backoff on
  429/5xx in `LastFMClient`, is far below Last.fm's per-key rate guidance
  (about 5 requests/second averaged).
- **Boundary.** `from` is inclusive at the watermark second; the duplicate is
  removed by Silver dedup.

## Azure / GitHub setup (done 2026-11-25; commands kept for reproducibility)

Entra app registrations and federated credentials are not billable. They are
still identity changes, so each step waits for the owner.

```powershell
az ad app create --display-name gh-lastfm-pipeline
az ad sp create --id <appId>
gh api repos/deadour/lastfm-data-platform/actions/oidc/customization/sub   # read sub_claim_prefix first
az ad app federated-credential create --id <appId> --parameters '{\"name\":\"gh-lastfm-prod-immutable\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"<sub_claim_prefix>:environment:lastfm-prod\",\"audiences\":[\"api://AzureADTokenExchange\"]}'
az role assignment create --assignee <appId> --role "Storage Blob Data Contributor" --scope "/subscriptions/<sub>/resourceGroups/rg-lastfm-dev/providers/Microsoft.Storage/storageAccounts/stlastfmedu/blobServices/default/containers/lake"
```

- The subject trusts only the `lastfm-prod` **environment** of this repository,
  identified by immutable owner/repo IDs.
  Forks, pull requests and other branches cannot get a token.
- The role is scoped to the `lake` container, not the account. The identity
  cannot create resources and has no subscription role.
- In GitHub → Settings → Environments → `lastfm-prod`:
  - secrets `LASTFM_API_KEY`, `LASTFM_USERNAME`;
  - variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
    `AZURE_STORAGE_ACCOUNT=stlastfmedu`, `AZURE_STORAGE_CONTAINER=lake`;
  - optionally restrict deployments to `main`.
- Then run the workflow manually (Actions → daily-pipeline → Run workflow),
  check `list-files` and the checkpoint, and only then enable the `schedule`
  block (done after the first successful run).

## Costs (real, as of this phase)

| Item | Cost |
| --- | --- |
| GitHub Actions, standard runner, **public** repo | $0 (no minute limit) |
| Entra app, service principal, federated credential, role | $0 |
| ADLS storage | Grows by one Silver snapshot (~11 MB) plus Gold (~1.2 MB) on each day with new scrobbles. About 0.35 GB/month, ~4 GB after a year. Hot LRS in Brazil South costs cents per GB-month, so well under $1/month the first year. |
| Transactions | ~30–40 writes and reads per run, a fraction of a cent per month |
| Egress to the runner | Restore plus verification is ~23 MB/run (~0.7 GB/month), inside Azure's free monthly internet egress allowance |

Check exact Brazil South prices in the Azure pricing calculator. A $5 budget
on `rg-lastfm-dev` with alerts at 50/80/100% is a reasonable guard (needs
approval). **Budget alerts notify; they do not stop spending.**

## Real limitations

- **Public logs.** Anyone can read workflow logs. Secrets are masked, and Azure
  SDK HTTP logging is silenced. Run IDs, row counts and blob paths are still
  visible.
- **Schedule reliability.** GitHub cron is best effort: runs can start late or be
  dropped under load. Times are UTC. Scheduled workflows in public repositories
  are disabled automatically after 60 days without repository activity.
- **Storage firewall.** Hosted runners use changing public IPs. The storage
  account must keep public network access (with Entra RBAC). An IP allow-list
  is not practical.
- **Full Silver rewrite.** Silver is one Parquet file, so every day with new
  scrobbles uploads and later restores ~11 MB. Old snapshots accumulate; a
  lifecycle rule to expire snapshots older than N days is a later change.
- **Snapshot id resolution is one second.** Two runs in the same second would
  collide; the second fails without committing (tested).
- **Not in the cloud.** Enrichment, `gold_enriched` and the Streamlit
  dashboard stay local.
- **Two writers of history.** After the cloud becomes authoritative, the local
  `data/` diverges. Running local ingestion plus `publish-layer` creates
  snapshots the checkpoint does not reference. Treat the cloud as the source
  of truth and download snapshots for local analysis.
- **Lease expiry.** If the runner dies mid-run, the lease expires in ≤ 60 s.
  If renewal fails during a long run, a second writer could start. The
  commit's ETag check still prevents a lost update.

## Daily schedule

- `cron: "17 6 * * *"` runs once a day at 06:17 UTC on `main`. GitHub may start
  it late or skip it under load.
- Schedule events carry no inputs, so `MAX_PAGES` falls back to `25` (5 000
  scrobbles, far above a normal day).
- A day with nothing new commits an unchanged watermark and uploads no new
  snapshots.
- A failed scheduled run commits nothing (exit codes 1–5). The checkpoint
  keeps the last good state and the next day retries the same window. The
  first failed run (45673908480) confirmed this in practice: `sequence` stayed 0.
- To pause without a code change: Actions → daily-pipeline → **Disable workflow**.

## Rollback

Disable the workflow (Actions → Disable, or comment the trigger). The
checkpoint history lives only in the current document, so keep the
`backup-state` snapshots. To undo a bad commit, write the previous document
back through the same ETag protocol. Removing the role assignment immediately
cuts all access.

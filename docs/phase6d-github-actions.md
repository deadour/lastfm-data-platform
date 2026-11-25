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
- Last.fm secrets **not** set; the workflow is not on `main` yet.
- Cron disabled; no ingestion has run in the cloud.

## Resources created (2026-11-25)

| What | Identifier | Notes |
| --- | --- | --- |
| Checkpoint blob | `lake/metadata/checkpoints/lastfm_recent_tracks.json` | `sequence` 0, watermark `1790979172`, points to `silver/scrobbles/snapshot=20261002T223940Z` (hashes `54004e83…5f5a`, `63efceb1…f6af`); seed ETag `"0x8DF4B1D2ECD23BC"` |
| Entra app registration | `gh-lastfm-pipeline`, appId `8b235061-3bc6-45ef-83dd-0ad1473b583a` | single tenant; **no client secrets or certificates** |
| Service principal | objectId `40466d4b-cee5-47e3-95a7-708bb80a7f51` | |
| Federated credential | `gh-lastfm-prod` | issuer `https://token.actions.githubusercontent.com`, subject `repo:deadour/lastfm-data-platform:environment:lastfm-prod`, audience `api://AzureADTokenExchange` |
| Role assignment | `5f7d651b-81a7-4d25-8008-6ee4368bbb41` | *Storage Blob Data Contributor* on `…/stlastfmedu/blobServices/default/containers/lake` only; the SP has no other role |
| GitHub environment | `lastfm-prod` | deployments limited to branch `main`; repo uses the default OIDC subject format |
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
az ad app federated-credential create --id <appId> --parameters '{\"name\":\"gh-lastfm-prod\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:deadour/lastfm-data-platform:environment:lastfm-prod\",\"audiences\":[\"api://AzureADTokenExchange\"]}'
az role assignment create --assignee <appId> --role "Storage Blob Data Contributor" --scope "/subscriptions/<sub>/resourceGroups/rg-lastfm-dev/providers/Microsoft.Storage/storageAccounts/stlastfmedu/blobServices/default/containers/lake"
```

- The subject trusts only the `lastfm-prod` **environment** of this repository.
  Forks, pull requests and other branches cannot get a token.
- The role is scoped to the `lake` container, not the account. The identity
  cannot create resources and has no subscription role.
- In GitHub → Settings → Environments → `lastfm-prod`:
  - secrets `LASTFM_API_KEY`, `LASTFM_USERNAME`;
  - variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
    `AZURE_STORAGE_ACCOUNT=stlastfmedu`, `AZURE_STORAGE_CONTAINER=lake`;
  - optionally restrict deployments to `main`.
- Then run the workflow manually (Actions → daily-pipeline → Run workflow,
  `max_pages=100`), check `list-files` and the checkpoint, and only then
  uncomment the `schedule` block.

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

## Rollback

Disable the workflow (Actions → Disable, or comment the trigger). The
checkpoint history lives only in the current document, so keep the
`backup-state` snapshots. To undo a bad commit, write the previous document
back through the same ETag protocol. Removing the role assignment immediately
cuts all access.

# Phase 6C — Cloud readiness (audit, checkpoints, container)

Phase 6C prepares autonomous execution without deploying anything. No Azure
resource, role, schedule or remote checkpoint was created.

## Data flow today

```text
Last.fm API ──ingest_scrobbles──▶ data/bronze/…/run_<id>/page_NNNN.json + run_metadata.json
                                      │  (watermark = newest scrobble in *completed* runs)
                                      ▼
                        transform_scrobbles ──▶ data/silver/scrobbles/scrobbles.parquet + _metadata.json
                                      │          (processed_bronze_runs; dedup on scrobble_id)
                                      ▼
                build_gold / build_enriched ──▶ data/gold/<mart>/…  data/gold_enriched/…
                                      ▼
                          dashboard/app.py (local Streamlit, reads Gold)

Opt-in, manual only: azure_cli upload-bronze | publish-layer | backup-state ──▶ ADLS lake/
```

Everything is local by default. Azure holds manual copies only; no job reads
from it.

| Step | Command | Writes | Volume |
| --- | --- | --- | --- |
| Incremental ingest | `python -m src.ingestion.ingest_scrobbles` | new Bronze run directory | 1 API call per 200 scrobbles since the watermark |
| Silver | `python -m src.transformation.transform_scrobbles` | replaces `scrobbles.parquet` (~11 MB) | reads new completed runs, rewrites whole table |
| Gold | `python -m src.analytics.build_gold` | replaces `data/gold/*` (~1.2 MB) | full rebuild from Silver |
| Job (new) | `python -m src.jobs.run_pipeline --max-pages 25` | the three above | at most 25 pages |

## Incremental state and the watermark fix

- State is file-based: `run_metadata.json` per Bronze run (`running` →
  `completed` | `failed` + `failure_type`), Silver `processed_bronze_runs`,
  Gold/enrichment `_metadata.json`. There is no lock, and nothing restores state.
- Last.fm returns the **newest** tracks first. Before 6C the watermark scanned
  pages from *every* run, so a `--max-pages 1` incremental run (`failed /
  MaxPagesLimit`) stored the newest page of a gap and moved the watermark past
  older, never-fetched pages: **permanent data loss**, not duplication. Silver
  was unaffected because it reads completed runs only.
- 6C restricts `latest_completed_timestamp` to completed runs. On the real local
  data the value is unchanged (`1790979172`), because only completed runs exist
  locally; legacy run directories without metadata are now ignored.
  Repeated windows are harmless: Silver deduplicates on `scrobble_id`.

## Remote checkpoint design (implemented, not wired in)

`src/storage/checkpoint.py` defines the protocol a cloud job will use:

1. Lease `metadata/checkpoints/lastfm_recent_tracks.lock` (single writer, 409 → stop).
2. Read `metadata/checkpoints/lastfm_recent_tracks.json` with its ETag.
3. Ingest → Silver → Gold → publish snapshots (all idempotent).
4. Commit only a `completed` run with all pages, a non-decreasing watermark and
   a known schema, using `If-None-Match: *` (first) or `If-Match: <etag>`.

A crash or network error before step 4 leaves the old checkpoint, so the retry
repeats the window safely. Backups (`backup-state`) are immutable copies for
humans; the checkpoint is the single mutable document a job trusts. Not yet
done: lease renewal for runs longer than the lease, creating the lock blob,
seeding the first checkpoint from the verified backup, and job wiring.

## data/gold "access denied"

- Operation: opening any file under `data/gold/` for read (`open`, `Get-Acl`,
  `icacls`) → `EACCES` / "Acceso denegado". Not a lock, a symlink or an in-use
  file: the directories inherit normal ACLs, but each file carries an explicit,
  owner-only DACL (SYSTEM, Administrators, OWNER RIGHTS).
- Cause: `build_gold` staged files in `tempfile.mkdtemp`, which since Python
  3.12.4 on Windows applies an owner-only ACL (CVE-2024-4030 fix). `os.replace`
  keeps that ACL. Those files were built by the Codex sandbox account
  (`CodexSandboxOffline`), so `sistema` cannot read them. `gold_enriched` was
  built by `sistema` and is readable.
- Fix: staging now uses a plain `mkdir` in the output parent, so files inherit
  the parent ACL. Verified by rebuilding Gold into a scratch directory: files
  carry inherited ACLs and are readable.
- The existing files are still unreadable. Without admin rights there are two
  options, both needing the owner's decision: rebuild Gold locally
  (`python -m src.analytics.build_gold`; replaces the 9 files with a
  deterministic rebuild from the same Silver, new `generated_at`), or take
  ownership as administrator.

## Container

`Dockerfile` (Python 3.12-slim, non-root, `requirements-job.txt` only) and a
`.dockerignore` that excludes `.env`, `data/`, `.venv`, tests and the dashboard.
The image runs `python -m src.jobs.run_pipeline --max-pages 25`; secrets come
from environment variables at run time. Exit codes: 0 success, 2 page cap
reached (partial, not a success), 3 no completed run, 1 any other failure.
Logs are one JSON object per line.

**The image has not been built.** Docker Desktop does not run on the owner's
machine. Phase 6D can build in the cloud with `az acr build`, which needs no
local Docker.

Data persistence in a container is not solved by the image: Phase 6D must sync
the working set from ADLS before the run and publish after it (see the plan).

## Phase 6D plan (superseded)

> Superseded by [GitHub Actions + ADLS](phase6d-github-actions.md) to avoid
> ACR, Log Analytics and Container Apps costs. Kept for reference.

**Region:** Brazil South. It satisfies the subscription's "Allowed resource
deployment regions" policy (chilecentral, newzealandnorth, brazilsouth,
northcentralus, southcentralus) and lists Container Apps `jobs` and
`managedEnvironments`. It also keeps compute next to `stlastfmedu` (no
cross-region egress). Providers `Microsoft.App`,
`Microsoft.ContainerRegistry` and `Microsoft.OperationalInsights` are
**NotRegistered**; registering them is the first approval.

**Resources (all in `rg-lastfm-dev`):**

| Resource | SKU | Estimate/month |
| --- | --- | --- |
| Container Apps environment (Consumption) | Consumption | $0 idle |
| Container Apps Job, cron `0 6 * * *`, 0.5 vCPU / 1 GiB, timeout 30 min, retries 1, parallelism 1 | Consumption | ~$0 (inside the free monthly vCPU-s/GiB-s grant for a few minutes per day) |
| Log Analytics workspace, 30-day retention, daily cap 0.1 GB | Pay-as-you-go | < $1 |
| Container registry | Basic | ~$5 (largest fixed cost; GHCR is the alternative) |
| User-assigned managed identity | — | $0 |
| Storage (existing) | LRS Hot | cents |

Expected total: **$5–7/month** with ACR Basic, ~$1 without. Create a $10
budget on the resource group with alerts at 50/80/100%. **Alerts notify;
they do not stop spending.** Deleting the resource group is the stop.

**RBAC (least privilege):** the managed identity gets *Storage Blob Data
Contributor* scoped to the `lake` **container**, not the account. It also
gets *AcrPull* on the registry. The Last.fm API key goes into a Container Apps
secret (or Key Vault later) and is never baked into the image.

**Steps:**

1. Register providers; create the Log Analytics workspace, the environment,
   ACR and the identity in `brazilsouth`.
2. Build and push without local Docker:
   `az acr build -r <acr> -t lastfm-pipeline:<git-sha> .` (the first build doubles as the Dockerfile test).
3. Assign the two roles and wait for propagation.
4. Add the job wiring (separate change): download the Silver snapshot and the
   checkpoint, run, publish Bronze/Silver/Gold, commit the checkpoint. Seed the
   first checkpoint from the verified backup.
5. Create the job with a **manual** trigger first; run it once with
   `--max-pages 2`. Exit code 2 is expected if more than 400 tracks are pending.
6. Verify in ADLS (`list-files`) and in Log Analytics; then switch to the cron
   trigger.

**Rollback:** disable or delete the job (`az containerapp job delete`); the
checkpoint and snapshots stay versioned. If a bad commit happened, write the
previous checkpoint back with the ETag protocol. Deleting `rg-lastfm-dev`
resources other than `stlastfmedu` removes all compute cost.

## Requires explicit owner approval

- Rebuilding local `data/gold`, or taking ownership of it as administrator.
- Any `backup-state --confirm` run.
- Registering providers and creating any Azure resource, role assignment or budget.
- Running real ingestion (`run_pipeline` or `ingest_scrobbles`) against Last.fm.
- Commits, push, PR.

# Frontend statistics from Azure

The exporter runs independently of ingestion. A GitHub-hosted runner downloads
the committed snapshots, builds `stats.json` and can deploy the existing
Cloudflare Pages frontend with that file at `/data/stats.json`.

```text
existing daily-pipeline → committed Azure Gold + Silver snapshots
                                      ↓ OIDC, SHA-256 checked
                             export-frontend workflow
                                      ↓
                         public artifact: stats.json only
                                      ↓ optional publication
                   existing Cloudflare Pages /data/stats.json
```

This change prepares the workflow; it does not activate it or deploy the site.
The production checkpoint, leases, snapshots, ingestion code and
`daily-pipeline.yml` are unchanged. There is no new cron.

## Inputs and output

`python -m src.jobs.export_stats` reads
`metadata/checkpoints/lastfm_recent_tracks.json` once and pins both snapshot
references from that document. It does not choose the latest folder by listing:
a newer folder might belong to an incomplete pipeline run. Each required file
must have a matching SHA-256 from the checkpoint. The export also checks that
Gold's source row count and Silver update timestamp match the restored Silver.

Gold supplies totals, artists, tracks, years, months, rhythm and streaks. Silver
is also required because there is no album Gold mart yet: the exporter derives
album counts and each track's most-played album from Silver. It never rebuilds
Gold or performs ingestion as a side effect.

Private snapshots exist only in a temporary runner directory, removed when the
command finishes. Only `output/stats.json` is uploaded as an Actions artifact,
with one-day retention. Do not upload the working directory, catalogs, Parquet
files, checkpoint documents, environment files or provider responses. Artifacts
in this public repository can be downloaded by other users.

The JSON is the existing `StatsFile` v1 contract. It deliberately publishes
listening aggregates and top artists/albums/tracks plus confirmed public cover
URLs; it excludes the Last.fm username, event rows, credentials, lake paths,
watermarks and checkpoint metadata. Publication makes those aggregates public.
No generated listening data or catalog is committed to Git. Both artifact upload
and deployment run the same `isStatsFile` validator used by React. Mock sources,
unknown/private fields, malformed nested records and credential-bearing URLs
are rejected. Missing statistics produce an unavailable state, never fictional
artists. Covers and attribution links are restricted to public HTTPS provider
hosts without credentials or query strings.

## Artwork persistence

The separate private blob `artwork/frontend/catalog.json` preserves resolved
matches and manual-review statuses between runners. It is not an ingestion
checkpoint. `--skip-artwork-refresh` reads it without any remote write or
provider request. If absent, statistics still export with placeholder covers.

With refresh enabled, only the top 100 albums are considered; confirmed,
rejected and review-pending rows are reused, and misses expire after 30 days.
The refreshed catalog is saved using its original ETag, or create-only when
absent. A concurrent catalog change fails the export rather than silently
replacing a review. No other blob is written. Provider interruptions retain
confirmed progress and allow fresh statistics to export with the available
covers; no ambiguous match becomes a published cover.

No private catalog is stored in GitHub cache or included in the public artifact.
Review commands in `docs/artwork.md` remain local; a future remote-review UI is
outside this change. Upload an intentionally reviewed catalog separately if
needed; do not replace an existing cloud catalog without checking its ETag.

## Azure OIDC

The workflow reuses `environment: lastfm-prod`, `azure/login@v2` and the existing
GitHub environment variables:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_STORAGE_ACCOUNT`
- `AZURE_STORAGE_CONTAINER`

The account and container remain `stlastfmedu` / `lake`. The job grants
`contents: read` and `id-token: write`, authenticating through the existing Entra
federated credential. Do not create an Azure client secret, account key or SAS.
No Last.fm ingestion secret is passed to the export job.

This repository uses an immutable OIDC subject tied to `lastfm-prod`; the
environment is restricted to `main`. Keep those protections intact. The workflow
must exist on `main` before manual dispatch or `workflow_run` events can run.
Both jobs check out the exact same trusted `github.sha`, not independently moving
branches or an arbitrary frontend ref. Do not relax the environment to test
feature branch code with production credentials. See
[the existing OIDC setup](phase6d-github-actions.md) and
[GitHub's Azure OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure).

The existing container-scoped Contributor role permits catalog updates. A
read-only Azure identity would suffice for statistics with artwork refresh
disabled, but would need its own federation and configuration; none is
provisioned here.

## First manual verification

Once the reviewed workflow is on `main`:

1. Leave repository variables `FRONTEND_EXPORT_AUTOMATIC` and
   `FRONTEND_PUBLICATION_VERIFIED` unset or `false`.
2. Actions → `export-frontend` → Run workflow → `main`.
3. Keep `publish=false` and `refresh_artwork=false`. The command restores the
   cloud snapshots and uses any existing cloud catalog. No Azure blob is written.
4. Download the `frontend-stats` artifact. Check `source="gold"`,
   `schema_version=1`, `data_as_of`, totals and the expected arrays. Its contents
   must be only `stats.json`, not the private inputs.
5. Run manually with `refresh_artwork=true`, still `publish=false`, to resolve
   the first covers and persist the isolated catalog. This is the first new
   cloud write performed by the export workflow.

For a local verification with an existing Azure login, install
`requirements-job.txt` in the project Python 3.12 environment, then run:

```powershell
python -m src.jobs.export_stats --account stlastfmedu --container lake --out data/exports/frontend/stats.json --skip-artwork-refresh
```

This does not require local Silver or Gold. A missing, incomplete or inconsistent
committed snapshot causes a failure; the exporter does not guess an alternative
snapshot, seed state or advance a watermark. A failed export prevents publication
and leaves the last successful frontend deployment available.

## Publish to the existing Cloudflare Pages project

Keeping `/data/stats.json` on the same origin needs no loader or CSP changes.
The publication job downloads only the public artifact into
`site/frontend/public/data/stats.json`, tests and builds the frontend, verifies
`dist/data/stats.json` matches the validated input byte-for-byte, then deploys the
complete output with Wrangler. Vite `index.html` and compiled assets are required;
raw `frontend/` source is never deployed.
It does not deploy a stats-only directory, which would replace the rest of the
site. Existing Pages Function secrets remain managed in Cloudflare and are not
read or copied into this workflow.

Configure these in the existing `lastfm-prod` GitHub environment:

| Name | Type | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Account owning the existing Pages project |
| `CLOUDFLARE_PAGES_API_TOKEN` | Secret | Scoped token with Cloudflare Pages Edit for that account |

The project name is fixed to **`lastfm-data-platform`** in the preflight and
Wrangler command. `CLOUDFLARE_PAGES_PROJECT` and `FRONTEND_SOURCE_REF` from the
earlier draft are no longer used. The frontend and exporter must be merged to
`main`; no escape hatch permits deployment of a different source branch.

Use **Settings → Environments → lastfm-prod** for the two values above and the
existing five `AZURE_*` variables. Do not put the Cloudflare token in a repository
variable, commit, Pages build variable or browser `VITE_*` setting. Keep the
environment's deployment branch protection limited to `main`. Existing
`LASTFM_API_KEY` and `LASTFM_USERNAME` secrets in the Pages project's Production
environment serve now-playing; the export job never receives them.

### Create the least-privilege Cloudflare token

1. Cloudflare Dashboard → profile/avatar → **My Profile → API Tokens** (or the
   account's **Manage Account → Account API Tokens** page).
2. Choose **Create Token → Create Custom Token → Get started**. Name it
   `github-lastfm-pages`.
3. Add only **Account → Cloudflare Pages → Edit**. Do not select the broad
   Workers template or add DNS, zone, R2, KV or account-admin permissions.
4. Under **Account Resources**, choose **Include → Specific account** and the
   account already owning `lastfm-data-platform`, not all accounts. This is
   account-scoped permission, not project-only access. The fixed project name
   and protected GitHub environment limit workflow use.
5. Choose **Continue to summary → Create Token**. Put the one-time token into
   the GitHub **environment secret** `CLOUDFLARE_PAGES_API_TOKEN`; do not send it
   in chat. Put the owning account's ID into the **environment variable**
   `CLOUDFLARE_ACCOUNT_ID`.

Azure authentication is OIDC. Cloudflare Direct Upload uses its own scoped API
token; the Azure token cannot authenticate to Cloudflare. No Cloudflare token
is created or configured by this change. Follow
[Cloudflare's CI upload guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

### Safe transition from feature/frontend to Actions ownership

The existing Pages project currently uses **`feature/frontend`** as production
branch; Actions deploys **`main`**. Uploading to the wrong production branch can
create only a preview and leave the custom domain unchanged. Follow this order,
without editing DNS or domain settings:

1. Leave repository variables `FRONTEND_EXPORT_AUTOMATIC` and
   `FRONTEND_PUBLICATION_VERIFIED` unset or `false`.
2. In **Workers & Pages → lastfm-data-platform → Settings → Build → Branch
   control → Edit**, turn **Enable automatic production branch deployments**
   off. Set **Preview branches → None (Disable automatic branch deployments)**.
   Save before changing the production branch.
3. In **Deployments**, cancel queued/in-progress Git builds and wait until none
   can finish later and replace a stats-bearing deployment.
4. In **Build → Branch control**, change production branch from
   `feature/frontend` to **`main`**, keeping both automatic build controls off.
   Save and verify the settings persisted. Do not recreate the project,
   disconnect GitHub, or change custom-domain associations.
5. Keep build root `frontend`, build command `npm run build` and output `dist`
   as fallback configuration, but leave Git deployments disabled. Actions is
   the sole publication owner and inserts real statistics before building.
6. Keep the existing Production now-playing secrets in Cloudflare. Run manual
   Actions publication below. Do not retry an old Git build without stats after
   this transition.

Before deploying, `src.jobs.check_pages` makes a **GET-only** API request. It
requires the existing project name, production branch `main`, Git production
deployments disabled, and preview setting `none`. Unknown controls also block
publication. It does not create projects, modify settings, change DNS or read
secret values. Missing/insufficient API credentials are a publication boundary.
See [Cloudflare's exact branch controls](https://developers.cloudflare.com/pages/configuration/git-integration/).

Once configured, run manually with `publish=true`. Check
`https://fm.eduramirez.dev/data/stats.json`, confirm `source="gold"` and that the
frontend displays real totals and covers. The existing `/data/*` cache policy
can retain an older file for up to an hour; `data_as_of` describes dataset age,
while `generated_at` describes export time. Roll back the Pages deployment if
the result is wrong; there is no pipeline checkpoint rollback involved.
The post-deployment check compares the public JSON hash, application HTML and
compiled JS with this build, using cache-busting for stats. HTML fallback,
stale builds, preview-only uploads and raw-source deployments fail verification.
It retries briefly for propagation but never enables automation. It does not
automatically roll back; the owner must inspect/roll back a failed deployment.

## Automatic refresh, when explicitly enabled

Only after the manual publication and public verification succeed, set the two
**repository-level** variables `FRONTEND_PUBLICATION_VERIFIED=true`, then
`FRONTEND_EXPORT_AUTOMATIC=true`. Both are required. The verification flag is a
human attestation of the successful manual run, not automatically set by code.
This additional guard also prevents an old automatic flag from activating the
new workflow before its first manual verification. Both variables must be
repository-level because job conditions precede environment availability.

The new workflow then reacts to successful `daily-pipeline` completions from
`main` in this same repository, only for scheduled or manually dispatched runs.
It checks out trusted `main` code; it never executes triggering PR code or
downloads artifacts from the triggering workflow. It reads whatever consistent
Gold/Silver pair is committed when export begins, which may be newer than the
triggering run. If the pipeline made no new rows, republishing unchanged totals
is harmless. A failed pipeline completion does not trigger an export.

This uses the existing pipeline's cadence without editing its cron. Catalog
updates and publication are serialized within the new workflow, independently
of ingestion. Disable the repository variable to stop automatic export without
changing the production pipeline. No variable has been enabled by this change.

## Validation and cost

```powershell
python -m pytest -q tests/test_artwork.py tests/test_export_stats.py tests/test_export_workflow.py tests/test_workflow.py -p no:cacheprovider
python -m pytest -q tests -p no:cacheprovider
cd frontend
npm ci
npm test
npm run build
npm audit --audit-level=high
cd ..
actionlint -shellcheck= -pyflakes= .github/workflows/export-frontend.yml
git diff --check
```

Tests use fictional data and fake blob storage. They cover checksum rejection,
snapshot pairing, privacy of the public artifact, cached covers, concurrent
catalog changes and the absence of checkpoint or snapshot writes. Offline
validation does not establish that a new OIDC workflow or deployment has run.
The Python/React compatibility test invokes Node 22 on an export from fictional
cloud snapshots, so the combined suite requires Node 22 and Python 3.12. Actual
Azure availability is verified only by the authenticated manual workflow.

No paid compute service, database, container registry or additional hosting
service is introduced. This public repository uses a standard Ubuntu runner
([GitHub runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
Use the existing Cloudflare Pages free plan within its limits. Azure storage
reads, download egress and the small private catalog still consume existing
storage usage/credit. Artifact retention is one day; only dependency files are
cached, never private snapshots. There is no claim that all Azure operations
are free.

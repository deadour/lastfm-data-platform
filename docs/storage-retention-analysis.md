# Snapshot retention and Azure Storage cost analysis

Analysis only (2026-11-25). Nothing was deleted, no lifecycle rule was enabled,
no setting was changed and no resource was created.

## What is stored today (measured, read-only)

| Prefix | Files | Size |
| --- | --- | --- |
| `bronze/` | 10 | 1.94 MB (6A sample page + first cloud run) |
| `silver/scrobbles/snapshot=…` | 4 (2 snapshots) | 23.01 MB |
| `gold/snapshot=…` | 9 (1 snapshot) | 1.26 MB |
| `gold_enriched/snapshot=…` | 2 | 0.01 MB |
| `metadata/checkpoints/` | 2 (checkpoint + lock) | < 1 KB |
| `metadata/state_backups/` | 6 | 0.38 MB |
| `metadata/azure-test.json` | 1 | < 1 KB |
| **Total** | | **26.6 MB, all Hot** |

Account settings (read with `az storage account show` / `blob-service-properties show`):

- **SKU `Standard_ZRS`**, not LRS as the earlier docs said. ZRS keeps three copies
  across zones and costs more per GB than LRS. **It does not support the Archive tier.**
- Hot default tier, HNS on, public network access on, TLS 1.2.
- **Blob soft delete: 7 days**, container soft delete: 7 days. Deleted data is
  recoverable for a week.
- Blob versioning and change feed: off. No lifecycle management policy exists.
- `allowSharedKeyAccess: true`. The pipeline never uses keys, but they exist.
  See risks.

## Growth

Each day with new scrobbles the job writes:

- a new Silver snapshot (~11.6 MB, the whole table);
- a Gold snapshot (~1.3 MB);
- a Bronze run (tens of KB for a normal day).

That is **~13 MB/day, ~0.4 GB/month, ~4.7 GB/year** if nothing is pruned.
Days with no new scrobbles write nothing new.

Silver dominates: about 90% of growth is the same table rewritten daily.

## What is needed to recover

| Data | Rebuildable from | Keep |
| --- | --- | --- |
| Bronze runs | nothing (raw API responses) | **forever** |
| Silver snapshot | Bronze runs (`transform --full`) | current + a few |
| Gold snapshot | Silver (`build_gold`) | current + a few |
| Checkpoint | the snapshot it names + Bronze | never delete; written only by the job |
| State backups | — | keep (tiny) |

**Gap: ADLS cannot rebuild Silver today.** The 585-page historical backfill
(`run_20261002T215941Z`, 148 MB; 160 MB for all local Bronze) exists only on
this PC. Until it is uploaded, the Silver snapshots in ADLS are the only cloud
copy of history before 2026-10-02. Pruning old Silver snapshots before that is
safe only because the checkpoint's current snapshot already contains all of
history. Losing it would lose history in the cloud.

Uploading that Bronze once with `upload-bronze` costs about 160 MB of storage,
a few cents per month, plus ~640 write operations. It needs owner approval.
It is the single most valuable step for recoverability.

## Options compared

Volumes are tiny, so every option costs cents. The real differences are safety
and effort. Prices are approximate for Brazil South; check the pricing
calculator, because Brazil South is pricier than US regions and ZRS costs
more than LRS.

| Option | 1-year size | Approx. storage cost at 12 months | Recovery | Risk |
| --- | --- | --- | --- | --- |
| A. Do nothing | ~4.7 GB Hot | well under $0.50/month | every daily snapshot | none; grows without limit |
| B. Lifecycle: tier snapshots to **Cool** after 30 days | ~0.4 GB Hot + ~4.3 GB Cool | roughly half of A | every snapshot, still online | 30-day early-deletion charge if a Cool blob is deleted sooner; slightly higher read cost |
| C. Lifecycle **delete** snapshots older than N days | ~N × 13 MB | lowest | only last N days (+7 days soft delete) | **can delete the snapshot the checkpoint points to** if the job stops for more than N days |
| D. App-side prune that reads the checkpoint (recommended later) | current + last 7 daily + 1 per month | lowest after C | the last week daily, monthly anchors for a year, current always | needs code and tests; still delete-based |

Archive is not an option on ZRS. On LRS it would need hours to rehydrate,
which is poor for a restore path.

## Recommendation

1. **Now (the cheapest safe step): change nothing.** Costs stay in cents for
   months. Let the scheduled run settle first.
2. **Upload the historical Bronze once** (needs approval). After that, Silver
   and Gold are disposable caches and any of them can be rebuilt from Bronze.
3. **Then add option B as a non-destructive rule**: tier `silver/`,
   `gold/`, `gold_enriched/` and `metadata/state_backups/` blobs to Cool after
   30 days. Leave `bronze/` and `metadata/checkpoints/` untouched (Hot).
   Tiering never removes data and Cool blobs stay readable online, so the
   checkpoint keeps working whatever its age.
4. **Only later, option D** for deletion. A small `prune-snapshots` command:
   - dry-run by default;
   - reads the checkpoint first and never deletes the snapshot it references;
   - keeps the last 7 snapshots plus the first snapshot of each month for 12
     months;
   - deletes only after the job has committed, with soft delete (7 days) as
     the last safety net.
   Prefer this to a lifecycle delete rule (option C), which cannot know what
   the checkpoint references.
5. **Optional, larger saving.** Silver is rewritten in full each day. Writing
   incremental Silver parts (one small Parquet per run) instead of a full
   snapshot would cut growth from ~13 MB to a few hundred KB per day. That is
   a pipeline change, so it is a separate decision.

Draft of the step 3 rule, **not applied**:

```json
{
  "rules": [{
    "name": "snapshots-to-cool-after-30d",
    "enabled": true,
    "type": "Lifecycle",
    "definition": {
      "filters": {"blobTypes": ["blockBlob"], "prefixMatch": ["lake/silver/", "lake/gold/", "lake/gold_enriched/", "lake/metadata/state_backups/"]},
      "actions": {"baseBlob": {"tierToCool": {"daysAfterModificationGreaterThan": 30}}}
    }
  }]
}
```

Applying it would be `az storage account management-policy create`, and it
needs owner approval. Note that `lake/metadata/` as a whole must **not** be
matched: the checkpoint and the lock live there.

## Other cost and risk notes

- **ZRS vs LRS.** For a personal project, LRS is enough and cheaper. ADLS
  redundancy changes go through a conversion or migration process. This is a
  decision for the owner, not urgent at this size.
- **Shared key access is enabled.** Disabling it (`allowSharedKeyAccess=false`)
  would leave Entra-only access. That matches how the pipeline already works.
  Verify that the portal and the owner's tools still work before changing it.
- **Egress.** Each run downloads the current Silver snapshot (~11.6 MB) to the
  runner, plus verification reads (~0.7 GB/month). That stays within the free
  monthly allowance at this size.
- **Transactions.** ~40 per run, a fraction of a cent per month.
- **Budget alert.** A $5 budget on `rg-lastfm-dev` is still suggested and not
  created. It notifies; it does not stop spending.

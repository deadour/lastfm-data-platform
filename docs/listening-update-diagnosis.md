# Listening update diagnosis — 2026-11-26

Checked around 02:00 Argentina time:

- `daily-pipeline` is active on the default branch `main`. Its original cron,
  `17 3 * * *`, corresponds to 00:17 Argentina.
- The Actions API lists three runs, all `workflow_dispatch`, and no scheduled
  run. This confirms the missing scheduled event, but does not identify why
  GitHub did not deliver it.
- The last manual run, [45736734250](https://github.com/deadour/lastfm-data-platform/actions/runs/45736734250),
  started at 22:35 Argentina on November 25. Azure OIDC succeeded. Last.fm
  returned HTTP 500 on all six attempts; the job exited with `LastFMHTTPError`
  and left the checkpoint unchanged.
- Direct read-only probes returned HTTP 200 for `user.getInfo`, but HTTP 500
  with API error 8 for `user.getRecentTracks`, both for the configured account
  and the independent reference account `rj`.
- `FRONTEND_EXPORT_AUTOMATIC` and `FRONTEND_PUBLICATION_VERIFIED` are both
  `true`. The automatic export correctly requires a successful ingestion.
  Re-exporting a snapshot does not recover newer scrobbles from Last.fm.

[GitHub documents](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)
that scheduled events can be delayed or dropped under load. This is a possible
explanation, not a confirmed cause of this particular missing event.

## Local changes

The workflow retains 00:17 and adds a recovery attempt at 02:47 Argentina
(`47 5 * * *`). Existing concurrency, lease, checkpoint and deduplication rules
still apply. A failed attempt never publishes partial ingestion. Both schedules
depend on GitHub's event delivery and Last.fm availability.

Catalog generation is part of the existing export: up to 300 artist pages,
500 albums and 100 songs. No separate catalog scheduler is needed. The live
widget is independent of that daily pipeline and polls every 30 seconds.

These source changes take effect in Actions after they reach `main`; local
changes alone do not update the remote workflows or public website.

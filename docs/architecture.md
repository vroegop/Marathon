# Architecture decision: where the run data comes from

Status: decided 2026-09-25 (revisit if Strava changes its API programme again or if
OHealth gains a file export).

## Context

- Runs are recorded on a OnePlus Wear OS watch with the native OHealth workout tracker,
  which syncs to the OHealth phone app, Health Connect and (since mid-2024) Strava.
- Goal: a personal, static training site on GitHub Pages plus periodic plan updates made
  with an AI assistant working from the full history (distance, pace, heart rate,
  elevation, cadence, per-second streams).
- Decision drivers, in order: (1) ease of syncing, (2) completeness of data,
  (3) robustness (no lost GPS/HR), plus two that surfaced during research: (4) whether the
  data source's terms allow long-term storage in this repository and analysis by an AI
  assistant, and (5) cost.

## Decision

**The repository is the system of record. It is filled from the athlete's own activity
files (Strava's bulk export, i.e. the original FIT files the watch produced) with
`scripts/ingest.mjs`. The Strava API is not the backbone; it is kept as an optional,
clearly caveated automation.**

Pipeline:

```
OnePlus watch (OHealth tracker)
   -> OHealth app -> Strava (OHealth's built-in "Sync to Strava")
   -> Strava "Request your archive" (zip: activities.csv + activities/*.fit.gz originals)
   -> node scripts/ingest.mjs export.zip      (local; strips GPS by default)
   -> data/*.json committed to git             (index, per-run details, per-second streams)
   -> GitHub Pages site (site/) + training-plan analysis read data/
```

## Options considered

### A. Strava API pulled nightly by a GitHub Action (built, optional)

What it gives: `SummaryActivity` list, `DetailedActivity` (splits, laps, best efforts,
device), 11 stream types at full resolution, HR zones. Fully automatic once set up.

Why it is not the backbone (all verified on Strava's own pages, September 2026):

- Since 1 June 2026 a Strava subscription on the developer's account is a prerequisite
  for creating an API application, even in single-player mode. Apps without one get
  `403 Forbidden ... "code":"Inactive"` while the token refresh keeps succeeding.
- The API Policy (effective 1 June 2026) forbids keeping API data in a cache for more than
  seven days, building an archive "through repeated authorized API calls", displaying it to
  anyone but the athlete (a public Pages site shows it to everyone), and, in section 5.3,
  any "ingestion into a context window or working memory" of an AI application. That last
  clause rules out the intended use of this repository for API-sourced data. The policy
  explicitly preserves the user's own bulk export right (section 6.6), which is why the
  export path is clean.
- The base URL and auth-header rules change again by June 2027.

It stays in the repo (`scripts/strava-sync.mjs`, `.github/workflows/sync-strava.yml`)
because it is tested and useful as a freshness feed for someone who has a subscription and
accepts those terms; the workflow is a no-op until the secrets exist.

### B. Strava bulk export + local ingest (chosen)

- Free, a user right independent of the developer programme, no tokens.
- The archive contains the original uploaded files. For OHealth-synced runs that is the
  file OHealth uploaded (FIT or TCX), i.e. the watch's own per-second records: GPS,
  barometric altitude, heart rate, cadence, temperature, laps, pauses.
- Covers the whole history in one download; re-importing a newer archive only adds new
  activities (keyed by Strava activity id from `activities.csv`).
- Cost: a manual "Request your archive" on strava.com every few weeks (the email link
  arrives within minutes to hours), then one command locally and a git push. That matches
  the intended "update every now and then" cadence.
- Unverified until the first export is opened: that OHealth's Strava upload includes HR and
  cadence (see "Verify once" below) and whether it arrives as FIT or TCX (both are
  supported by the ingest).

### C. Health Connect export (fallback, not implemented)

Health Connect's "Backup and restore -> Scheduled export" writes an unencrypted SQLite
database (`health_connect_export.db` inside `Health Connect.zip`) to any cloud storage app,
daily if wanted. It contains exercise sessions, heart-rate series, speed, step cadence and
distance. But OHealth does not hold the `WRITE_EXERCISE_ROUTE` permission (checked in the
APK manifests of v4.32 and v4.60), so no GPS route or per-point altitude for OHealth runs,
and OHealth's Health Connect sync is widely reported as unreliable. Useful only for runs
that never reached Strava. A reader for it can be added later without changing the data
format.

### D. OHealth itself

No GPX/TCX/FIT/CSV export exists, and the phone app's data folder is not accessible
without ADB. A GDPR data-portability request is the only documented way to get older
OHealth-only workouts, and its format is undocumented. Nothing to build on.

### E. Strava MCP connector

Strava's sanctioned AI path (subscribers only, read-only, launched June 2026). It could
complement the plan work but cannot feed a static site, and it again needs the
subscription. Not part of the backbone.

### F. Recording with the Strava Wear OS app instead of OHealth

Reviews of the Watch 3 found both the native tracker and Strava's Wear OS app accurate
against Garmin. Only needed if OHealth's Strava sync turns out to drop HR or the route.

## Consequences

- Data completeness is as good as the source files: everything the watch recorded, plus
  derived metrics computed here (km splits, grade-adjusted pace with the Minetti model,
  best efforts, elevation gain with a 2 m hysteresis, time in HR zones).
- Nothing in the pipeline depends on an API token, a subscription or a third-party bridge
  app. If Strava ever changes the export, the same ingest also reads plain FIT/GPX/TCX
  files from any other source.
- History that exists only in OHealth (before Strava sync was enabled) cannot be recovered
  by any documented route; the plan starts from what Strava holds.
- The repository is public, so `sync.config.json` strips GPS coordinates, start/end points
  and place names by default. Heart rate, pace and distance are published. Make the
  repository private (GitHub Pages on private repositories needs a paid GitHub plan) before
  enabling `privacy.keepLatLng`.

## Verify once (first real export)

1. Open one recent run in Strava: it must show a map, a heart-rate graph and cadence.
   If not, OHealth's sync is dropping data; record with the Strava Wear OS app instead.
2. After `npm run ingest`, check `npm run report`: distance, moving time and average HR of
   the latest runs must match the watch.
3. Look at the file type of one entry in the export's `activities/` folder (`.fit.gz`
   expected). If OHealth uploads TCX, elevation comes from Strava's basemap rather than the
   watch barometer; that is acceptable.

## Sources

- Strava API getting started (subscription prerequisite): https://developers.strava.com/docs/getting-started/
- Strava API Policy, effective 2026-06-01 (sections 2.3, 3.3, 5.3, 5.5, 6.2, 6.6): https://www.strava.com/legal/api_policy
- Strava rate limits: https://developers.strava.com/docs/rate-limits/
- Strava bulk export: https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export
- OHealth manifest (no WRITE_EXERCISE_ROUTE): https://www.apkmirror.com/apk/heytap/heytap-health/ohealth-4-60-17_3e103a6_260324-release/ohealth-4-60-17_3e103a6_260324-android-apk-download/
- OnePlus Watch 3 page ("Workout data can also sync to Strava"): https://www.oneplus.com/us/oneplus-watch-3-43mm
- Health Connect scheduled export: https://support.google.com/android/answer/15323271
- Health Connect export implementation (AOSP ExportManager): https://github.com/GrapheneOS/platform_packages_modules_HealthFitness/blob/e42a6133a71038d47b669fe59871f3e84e5aa17a/service/java/com/android/server/healthconnect/exportimport/ExportManager.java
- Strava and Health Connect (write-only for workouts): https://support.strava.com/en-us/articles/15401554-health-connect-and-strava
- Watch 3 accuracy review: https://www.wareable.com/reviews/oneplus-watch-3-review

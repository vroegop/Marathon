# Marathon

A personal marathon-training site on GitHub Pages, fed by the runs recorded on a OnePlus
Wear OS watch, with the full history kept in this repository so a training plan can be
built and updated from real data.

**How the data flows** (why this and not the Strava API: see
[docs/architecture.md](docs/architecture.md)):

```
watch (OHealth tracker) -> OHealth app -> Strava -> Strava bulk export (zip of original FIT files)
   -> npm run ingest -> data/*.json in git -> GitHub Pages site + training-plan analysis
```

## One-time setup

1. **Let OHealth push runs to Strava.** In the OHealth app open Me (Personal Center) ->
   Data sharing and connect Strava. After the next run, open it on strava.com: it must show
   a map, a heart-rate graph and cadence. If anything is missing, record runs with the
   Strava app on the watch instead (see the architecture note).
2. **Enable GitHub Pages:** repository Settings -> Pages -> Build and deployment -> Source:
   *GitHub Actions*. The site is then published on every push to `main` that touches
   `site/` or `data/`.
3. **Install Node.js 20+** on your computer and run `npm install` in this folder once
   (the only dependency is Garmin's official FIT decoder).

## Updating the data (every few weeks)

1. On strava.com: profile picture -> Settings -> My Account -> *Download or Delete Your
   Account* -> *Request Your Archive*. Strava emails a link to `export_<id>.zip` (minutes
   to a few hours). Set the account language to English first, or the CSV headers are
   localized.
2. Ingest it. Activities already in `data/` are skipped, so a fresh full archive only adds
   what is new:

   ```sh
   npm run ingest -- ~/Downloads/export_12345678.zip
   npm run report          # sanity check: weekly volume, last runs
   git add data && git commit -m "data: runs up to 2026-09-25" && git push
   ```

   The ingest also accepts an extracted export folder, any folder of `.fit`/`.fit.gz`/
   `.gpx`/`.tcx` files, or single files. `--force` re-processes everything (after changing
   `sync.config.json`), `--dry-run` parses without writing.
3. Ask Claude to update the plan. It reads `data/` from the repository (or run
   `npm run report` and paste the output).

Preview locally with `npm run serve` and open http://localhost:8080/.

## What ends up in `data/`

See [docs/data-format.md](docs/data-format.md). In short: `activities.json` is the index
(one line per activity, all sports), `activities/<id>.json` holds splits, laps, best
efforts and time in HR zones, `streams/<id>.json` holds the per-second series (time,
distance, pace, heart rate, cadence, altitude, grade, temperature) for runs.

**Privacy:** this repository and the Pages site are public. `sync.config.json` therefore
drops GPS coordinates, start/end points and place names by default; heart rate, pace and
distance are kept. Only set `privacy.keepLatLng` to true in a private repository.

## Configuration (`sync.config.json`)

| key | meaning |
|---|---|
| `activityTypes` | sport types for which per-second streams are stored (default runs only; the index keeps every sport) |
| `privacy.keepLatLng`, `keepLocationNames`, `keepDescription` | what to publish |
| `timezone` | IANA zone used for files without their own offset (GPX, CSV-only rows); defaults to the machine's zone |
| `athlete.hrZones` | e.g. `[[0,120],[120,150],[150,165],[165,180],[180,-1]]`; enables time-in-zone per run |
| `elevationThreshold` | metres of climb before it counts as gain (2 m suits a barometric watch) |

## Optional: Strava API sync (automatic, but read this first)

`scripts/strava-sync.mjs` and the *Sync Strava* workflow pull new activities from the
Strava API every night into the same `data/` format. As of June 2026 this requires a paid
Strava subscription on the account that owns the API application, and Strava's API Policy
forbids keeping API data for more than seven days, showing it to anyone but yourself, and
feeding it to an AI assistant. It is therefore **not** the recommended path for this
project; it is kept for people who accept those terms. To enable it:

1. Create an API application at https://www.strava.com/settings/api with
   *Authorization Callback Domain* = `localhost`.
2. Run `STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... npm run auth`, approve in the browser
   and copy the refresh token it prints.
3. Add the repository secrets `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and
   `STRAVA_REFRESH_TOKEN`, then run the *Sync Strava* workflow from the Actions tab.
   Without the secrets the workflow exits without doing anything.

## Repository layout

```
site/                 static site (vanilla JS, no build step)
data/                 synced activities (JSON), committed
scripts/ingest.mjs    Strava export / FIT / GPX / TCX -> data/
scripts/report.mjs    text summary of the training history
scripts/strava-sync.mjs, scripts/strava-auth.mjs   optional Strava API path
scripts/build-site.mjs, scripts/serve.mjs          Pages build and local preview
docs/                 architecture decision and data format
test/                 node --test suites (mock Strava API, synthetic FIT export)
.github/workflows/    deploy-pages.yml, sync-strava.yml
```

`npm test` runs everything offline.

## Roadmap

- Training-plan generation from the history (weekly volume progression, long-run
  build-up, workout mix, taper) written into the site.
- Health Connect export reader for runs that never reached Strava.

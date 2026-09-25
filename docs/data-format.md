# Data format

Everything the site and the training-plan work reads lives in `data/`, written by
`scripts/ingest.mjs` (Strava bulk export / FIT / GPX / TCX files) or, optionally, by
`scripts/strava-sync.mjs` (Strava API). Both produce the same shapes. The repository is
the system of record: Strava is only the transport from the watch. All files are plain
JSON so they diff in git and can be fetched directly by the static site.

```
data/
  activities.json        index of every activity, newest first, one object per line
  activities/<id>.json   detailed activity: splits, laps, best efforts, HR zones
  streams/<id>.json      per-sample streams (time, distance, pace, HR, ...) for runs
  sync-state.json        bookkeeping written after every sync run
```

## `activities.json` (index)

One entry per Strava activity (all sport types when `indexAllTypes` is true in
`sync.config.json`, so cross-training counts towards load). Fields come straight from
Strava's `SummaryActivity`, trimmed and rounded:

| field | unit / meaning |
|---|---|
| `id` | Strava activity id (file name for details/streams) |
| `name`, `type`, `sport_type` | e.g. `Run`, `TrailRun`, `VirtualRun`, `Ride`, `Walk` |
| `workout_type` | runs: `0` default, `1` race, `2` long run, `3` workout (as tagged in Strava) |
| `start_date` | UTC ISO timestamp |
| `start_date_local` | wall-clock time where the run happened; the `Z` suffix is a Strava quirk, treat it as local time |
| `timezone`, `utc_offset` | e.g. `(GMT+01:00) Europe/Amsterdam`, seconds |
| `distance` | metres |
| `moving_time`, `elapsed_time` | seconds |
| `total_elevation_gain`, `elev_high`, `elev_low` | metres |
| `average_speed`, `max_speed` | m/s (pace in s/km = 1000 / speed) |
| `has_heartrate`, `average_heartrate`, `max_heartrate` | bpm |
| `average_cadence` | rpm as Strava reports it for runs (one foot; steps/min = 2×) |
| `average_temp` | °C from the device, if any |
| `suffer_score` | Strava "relative effort" (subscription accounts only) |
| `trainer`, `commute`, `manual`, `private`, `visibility` | flags |
| `gear_id`, `external_id`, `upload_id`, `device_name` | provenance (`external_id`/`device_name` show which app/watch recorded it) |
| `source` | `fit`, `gpx`, `tcx` (ingested file), `csv` (export row without a file, e.g. manual entries) or absent for the Strava API |
| `has_details`, `has_streams` | maintained by the scripts: whether the per-activity files exist |

## `activities/<id>.json` (detail)

Strava's `DetailedActivity` minus noise (kudos, photos, segment efforts, ...) and minus
location fields unless `privacy.keepLatLng` / `privacy.keepLocationNames` are enabled.
Notable additions over the index:

- `description`, `calories`, `perceived_exertion`, `gear` (`{id, name, distance}`)
- `splits_metric[]`: per-kilometre splits with `elapsed_time`, `moving_time`,
  `elevation_difference`, `average_speed`, `average_grade_adjusted_speed` (GAP),
  `average_heartrate`, `pace_zone`
- `laps[]`: watch laps (auto-laps or manual), same fields as splits plus `max_heartrate`,
  `average_cadence`, `total_elevation_gain`
- `best_efforts[]`: Strava's best 400 m / 1k / 1 mile / 5k / 10k / half / marathon inside
  the run, with `pr_rank`
- `zones[]`: time-in-zone distribution (`distribution_buckets[{min,max,time}]`); computed
  from the HR stream when `athlete.hrZones` is configured (ingest), or fetched from Strava
  (API path, subscription accounts only)
- ingested files also carry `source_file` and `device` (`{manufacturer, product, name}`)

For ingested files the splits, best efforts and grade-adjusted speed are computed here:
km splits from the distance stream (moving time excludes pauses and gaps longer than
15 s), best efforts as the fastest continuous window over each standard distance, and
grade-adjusted speed with the Minetti et al. (2002) running cost model. Elevation gain
comes from the device session when present, else from the altitude stream with a 2 m
hysteresis.

## `streams/<id>.json`

Columnar arrays, one value per sample (the watch typically records 1 Hz). All arrays
have the same length and index; `time` is seconds since start.

| key | unit |
|---|---|
| `time` | s |
| `distance` | m (cumulative) |
| `altitude` | m |
| `velocity_smooth` | m/s (Strava-smoothed; pace = 1000 / v) |
| `heartrate` | bpm |
| `cadence` | rpm (one foot) |
| `grade_smooth` | % |
| `moving` | 1 = moving, 0 = stopped |
| `temp` | °C (if the device records it) |
| `lat`, `lng` | degrees, only when `privacy.keepLatLng` is true |

Plus `activity_id`, `series_type` (`distance` or `time`), `original_size`, `resolution`.

## `sync-state.json`

`last_run`, `last_run_stats`, `activities`, `pending_details`, `pending_streams`
(how many activities still lack files; the nightly job keeps going until both are 0),
`stopped_early` (why the last run stopped, usually the Strava rate limit),
`rate_limit_usage`, `zones_available`.

## Privacy defaults

The repository (and the GitHub Pages site) is public. By default the sync therefore
drops everything that reveals where you run: GPS coordinates, start/end points, the
route polyline and city names. Heart rate, pace, distance, elevation profile and
activity names are kept, because the training plan needs them. Flip the `privacy`
switches in `sync.config.json` if the repository is private.

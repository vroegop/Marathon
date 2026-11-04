# Randy's running season

Training plan and progress for the 10k (1 Nov 2026), Texel Trail (6 Feb 2027), the Beer
Lovers Marathon (16 May 2027) and Iron Viking (25 Sep 2027).

Live at **https://vroegop.github.io/Marathon/**

- **Today**: countdown, today's session and a day-by-day timeline (scroll left for
  history). Strength, elliptical and mobility sessions have a "Post to Strava" button
  (one-time setup on the phone, explained when you first tap it).
- **Graphs**: personal records (fastest 1 km, 5 km, 10 km and up, once you've run them),
  volume, long runs, pace at the same heart rate, heart-rate zones, resting HR, sleep.
- **Plan**: races, training blocks, every week, what each session is for.
- **Strength**: the twice-weekly circuits, pelvis-control work and mobility routines, with
  how to do every exercise and why it helps running.
- **Journal**: why the plan changed.

## How it's kept up to date

1. Health Connect on the phone exports to Google Drive every day. Every night a GitHub
   Actions job downloads that export, imports it, commits the new data and deploys the
   site (also on demand: Actions, Deploy site, Run workflow).
2. Claude reviews the data, adjusts the plan, writes a journal note, and pushes.
3. Got sick, injured, or hit a goal? Say so and the plan is adjusted the same way.

### Setting up the nightly Drive import (once, on a computer)

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project
   (no billing needed) and [enable the Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) for it.
2. Under [Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts),
   create one (any name, no roles). Open it, Keys, Add key, Create new key, JSON: a key
   file downloads. Note the account's email address (`...@...iam.gserviceaccount.com`).
3. In Google Drive, share `Health Connect.zip` (or the folder it's in) with that email
   address as Viewer.
4. In this repository: Settings, Secrets and variables, Actions, New repository secret:
   - `GDRIVE_SA_KEY`: the whole contents of the key file.
   - `GDRIVE_FILE_ID`: the ID from the file's (or folder's) Drive link,
     `drive.google.com/file/d/<ID>/view`.
5. On the phone, set the Health Connect scheduled export to daily, to Google Drive.
6. Test it: Actions, Deploy site, Run workflow. Then delete the key file from your computer.

The service account can only read what was shared with it. The raw export stays in the
job's temporary folder; only the processed data in `site/data/` is committed.

Maintainer details are in [CLAUDE.md](CLAUDE.md).

## Run locally

```sh
python3 tools/import_health.py ~/Downloads/Health\ Connect.zip   # needs Python 3.11+
python3 tools/build_plan.py
python3 -m http.server 8765 --directory site
```

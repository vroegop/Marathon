# Randy's running season

Training plan and progress for the 10k (1 Nov 2026), Texel Trail (6 Feb 2027), the Beer
Lovers Marathon (16 May 2027) and Iron Viking (25 Sep 2027).

Live at **https://vroegop.github.io/Marathon/**

- **Today**: countdown, today's session, the week so far, and a day-by-day timeline
  (scroll left for history).
- **Graphs**: volume, long runs, aerobic efficiency, heart-rate zones, resting HR, sleep.
- **Plan**: races, training blocks, every week, what each session is for.
- **Journal**: why the plan changed.

## How it's kept up to date

1. Export Health Connect on the phone and hand the zip to Claude.
2. Claude runs the import, reviews the data, adjusts the plan, writes a journal note,
   and pushes. GitHub Actions deploys the site.
3. Got sick, injured, or hit a goal? Say so and the plan is adjusted the same way.

Maintainer details are in [CLAUDE.md](CLAUDE.md).

## Run locally

```sh
python3 tools/import_health.py ~/Downloads/Health\ Connect.zip   # needs Python 3.11+
python3 tools/build_plan.py
python3 -m http.server 8765 --directory site
```

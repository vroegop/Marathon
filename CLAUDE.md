# Running plan site: maintainer notes

Randy's training plan for four races (10k 1 Nov 2026, Texel Trail 24 km 6 Feb 2027,
Beer Lovers Marathon 16 May 2027, Iron Viking 42 km OCR 25 Sep 2027), published at
https://vroegop.github.io/Marathon/. Randy maintains nothing by hand: they send Health
Connect exports and tell Claude what happened; Claude updates the files and pushes.

## Layout

- `plan/athlete.toml`: HR max/rest and fitness (VDOT) history. Paces derive from VDOT.
- `plan/plan.toml`: races, phases, recurring volleyball, and every week spelled out.
- `plan/sessions.toml`: session library (templates, purpose text).
- `plan/adjustments.toml`: illness/injury periods and single-day overrides.
- `plan/journal.toml`: coach's notes; every plan change gets an entry explaining why.
- `tools/import_health.py <zip|db>`: export -> `site/data/activities.json`, `daily.json`.
- `tools/build_plan.py`: plan + data -> `site/data/plan.json` (past days frozen).
- `site/`: static pages (no build step), Chart.js from cdnjs on the graphs page.

## Playbooks

Always finish with: `python3 -m unittest discover tools && python3 tools/build_plan.py`,
check the output, commit `plan/` and `site/data/`, push to `main` (Pages deploys on push).

**New Health Connect export.** Run `python3 tools/import_health.py <path to zip>`
(it reads the zip directly), then build. Then review: weekly km vs plan,
statuses (missed/partial/too_hard), easy-run HR, resting HR trend, efficiency trend.
Adjust upcoming weeks if needed and add a `coach` journal entry summarising the review.
Never commit the raw export (`.gitignore` blocks `*.db`/`*.zip`).

**Race result or breakthrough.** Add a `[[fitness]]` entry (date = race date) with VDOT
from `tools/vdot.py:vdot_from_race(km, minutes)` and a `result` journal entry.
Future paces update automatically. For trail/OCR races don't derive VDOT from the time.

**Sick.** Add a `[[disruption]]` (kind "sick", return_days ~ length of illness, at least 3).
Rule of thumb: fever or chest symptoms = no running until 2 days symptom-free. Missed
<1 week: continue the plan after the return ramp. 1-2 weeks: repeat the last completed
week before resuming. >2 weeks: rewrite the block in plan.toml (cut peak long runs, keep
race dates) and explain in the journal.

**Injury.** `[[disruption]]` kind "injury"; replace runs with cross-training via
`[[override]]` where useful. Pain that changes the running gait = no running.
Return: walk/run, then easy only, no quality for at least a week.

**Schedule change** (busy weekend, holiday): `[[override]]` for single days; edit the
week in plan.toml for bigger moves. Keep the long run and one quality session if possible.

## Rules of the plan

- 3 runs/week in 2026 (Mon long, Thu quality, Sat easy; volleyball Wed/Fri),
  4 runs + strength from 2027 (Mon long, Tue easy+strength, Wed quality, Sat medium/trail).
- Weekly volume up at most ~10-15%, every 4th week lighter, long run <= ~45% of week early on.
- Easy runs are capped by HR zone 2, not pace. Randy tends to run easy days too hard.
- Past days are frozen in plan.json: do not hand-edit history; `--refreeze` only to fix bugs.
- Health Connect: OHealth (app id 1) is the watch; Google Fit duplicates are dropped.
  Exercise type 33 = run, 53/58 = walk (empirical mapping, see import_health.py).

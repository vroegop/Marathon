# Running plan site: maintainer notes

Randy's training plan for four races (10k 1 Nov 2026, Texel Trail 24 km 6 Feb 2027,
Beer Lovers Marathon 16 May 2027, Iron Viking 42 km OCR 25 Sep 2027), published at
https://vroegop.github.io/Marathon/. Randy maintains nothing by hand: they send Health
Connect exports and tell Claude what happened; Claude updates the files and pushes.

## Layout

- `plan/athlete.toml`: HR max/rest and fitness (VDOT) history. Paces derive from VDOT.
- `plan/plan.toml`: races, phases, recurring volleyball, and every week spelled out.
- `plan/sessions.toml`: session library (templates, purpose text).
- `plan/strength.toml`: exercise library, strength circuits per block, mobility routines.
- `plan/adjustments.toml`: illness/injury periods, single-day overrides, exercise swaps,
  and what Randy reported in chat.
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
Strength can usually continue around an injury: `[[exercise_swap]]` takes the painful
exercises out of every circuit for a period (knee: replace reverse-lunge, split-squat,
step-up, lateral-lunge with sl-glute-bridge / sl-hip-thrust; jumps with "" to drop them).

**Randy reports a session in chat** (before an export has it): `[[report]]` with the
date and `did = "<what they did>"` (counts as done) or `skipped = "<why>"` (shows as
missed with the reason). Works for past days; overrides don't (past days are frozen).

**Elliptical.** Randy has an elliptical and kettlebells at home. Every easy/recovery run
shows an elliptical alternative (computed in build_plan.py). Swap runs for planned
`{ s = "elliptical", mins = N }` sessions when knees or legs need relief; keep long runs,
quality sessions and race-specific trail runs as running.
Elliptical and strength sessions are recognised in exports by title (ELLIPTICAL_TITLES,
STRENGTH_TITLES); once a real one appears, add its exercise_type id to EXERCISE_KINDS.

**Strength.** Randy has 7, 9 and 11.5 kg kettlebells, resistance bands, bodyweight; likes
legs and core work, some upper body (rows, presses), and wants pelvis-rotation control and
mobility. In plan.toml a strength day is the run/elliptical plus `{ s = "strength" }`; the
first of a week gets circuit A, the second B; `circuit = "T"` is the light taper/travel
circuit, `rounds = 2` for lighter/peak weeks. The exercises come from the strength.toml
block covering the date, so edit a circuit there to change all future sessions. Progress
or regress a circuit when Randy reports it's too easy/hard (tips per item say how). Keep
every circuit at ~6 exercises with at least one pelvis-control exercise, and no new hard
leg work in the 4 days before a race. Every exercise key must exist (the build checks).

**Schedule change** (busy weekend, holiday): `[[override]]` for single days; edit the
week in plan.toml for bigger moves. Keep the long run and one quality session if possible.

## Rules of the plan

- 3 runs/week in 2026 (Mon long, Thu quality, Sat easy; volleyball Wed/Fri),
  4 runs from 2027 (Mon long, Tue easy, Wed quality, Sat medium/trail).
- Strength twice a week, 20 min straight after an easy run or the elliptical:
  2026 Tue (elliptical) + Sat (easy run); 2027 Tue (easy run) + Thu (elliptical).
  Sunday: 15 min mobility (recurring in plan.toml).
- Weekly volume up at most ~10-15%, every 4th week lighter, long run <= ~45% of week early on.
- Easy runs are capped by HR zone 2, not pace. Randy tends to run easy days too hard.
- Knee niggle in the week of 19 Oct 2026: watch for recurrence; prefer the elliptical for easy volume if it returns.
- Past days are frozen in plan.json: do not hand-edit history; `--refreeze` only to fix bugs.
- Health Connect: OHealth (app id 1) is the watch; Google Fit duplicates are dropped.
  Exercise type 33 = run, 53/58 = walk (empirical mapping, see import_health.py).

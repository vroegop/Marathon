#!/usr/bin/env node
// Print a plain-text training summary from data/ (used when building/updating the plan).
//   node scripts/report.mjs [--weeks 16]
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const weeksArg = process.argv.indexOf('--weeks');
const WEEKS = weeksArg >= 0 ? Number(process.argv[weeksArg + 1]) : 16;
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

const readJson = async (f, fb) => {
  try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return fb; }
};
const pace = (mps) => {
  if (!mps) return '   -  ';
  const s = Math.round(1000 / mps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const local = (a) => new Date(a.start_date_local.replace('Z', ''));
const isoWeekStart = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const all = await readJson(path.join(DATA_DIR, 'activities.json'), []);
const state = await readJson(path.join(DATA_DIR, 'sync-state.json'), {});
const runs = all.filter((a) => RUN_TYPES.has(a.sport_type || a.type)).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

console.log(`Activities: ${all.length} total, ${runs.length} runs. Last sync: ${state.last_run || 'never'}; pending: ${state.pending_details ?? '?'} details, ${state.pending_streams ?? '?'} streams.`);
if (runs.length === 0) process.exit(0);
console.log(`Runs from ${ymd(local(runs[runs.length - 1]))} to ${ymd(local(runs[0]))}.`);
const km = runs.reduce((s, a) => s + a.distance, 0) / 1000;
console.log(`Lifetime: ${km.toFixed(0)} km in ${hms(runs.reduce((s, a) => s + a.moving_time, 0))} h.`);

// Weekly table
const thisWeek = isoWeekStart(new Date());
console.log(`\nWeek        Runs   km    Time   Long  AvgPace  AvgHR`);
for (let w = WEEKS - 1; w >= 0; w -= 1) {
  const start = new Date(thisWeek);
  start.setDate(start.getDate() - w * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const wk = runs.filter((a) => local(a) >= start && local(a) < end);
  const dist = wk.reduce((s, a) => s + a.distance, 0);
  const time = wk.reduce((s, a) => s + a.moving_time, 0);
  const long = wk.reduce((m, a) => Math.max(m, a.distance), 0);
  const hrRuns = wk.filter((a) => a.average_heartrate);
  const hr = hrRuns.length ? hrRuns.reduce((s, a) => s + a.average_heartrate * a.moving_time, 0) / hrRuns.reduce((s, a) => s + a.moving_time, 0) : null;
  console.log(`${ymd(start)}  ${String(wk.length).padStart(3)} ${(dist / 1000).toFixed(1).padStart(6)}  ${hms(time).padStart(5)}  ${(long / 1000).toFixed(1).padStart(5)}  ${pace(time ? dist / time : 0).padStart(6)}  ${hr ? hr.toFixed(0).padStart(5) : '    -'}`);
}

console.log(`\nLast 10 runs`);
for (const a of runs.slice(0, 10)) {
  console.log(`${ymd(local(a))}  ${(a.distance / 1000).toFixed(1).padStart(5)} km  ${hms(a.moving_time)}  ${pace(a.average_speed)}/km  HR ${a.average_heartrate ? Math.round(a.average_heartrate) : '-'}  +${Math.round(a.total_elevation_gain || 0)} m  ${a.name}`);
}

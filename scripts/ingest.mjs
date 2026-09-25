#!/usr/bin/env node
// Ingest activity files into data/: a Strava bulk-export archive (export_*.zip),
// an extracted export folder, any folder of .fit/.gpx/.tcx files, or single files.
//
//   node scripts/ingest.mjs ~/Downloads/export_12345678.zip
//   node scripts/ingest.mjs path/to/folder --force
//
// Options:
//   --force      re-process activities that are already in data/
//   --dry-run    parse everything, write nothing
//   --quiet      only print the summary
//
// The result has the same shape as the Strava API sync (docs/data-format.md), so the
// site and the training-plan tooling do not care where an activity came from.
// Re-running on a newer export only adds what is new (keyed by activity id).

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { readZipEntries } from './lib/zip.mjs';
import { parseCsv } from './lib/csv.mjs';
import { parseFit } from './lib/fit.mjs';
import { parseGpx, parseTcx } from './lib/gpx.mjs';
import { assemble, normalizeSportType, tzOffsetSeconds, round } from './lib/activity.mjs';
import { readJson, writeJson, writeIndex, byStartDesc, dataPaths } from './lib/store.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const inputs = argv.filter((a) => !a.startsWith('--'));
const FORCE = flags.has('--force');
const DRY_RUN = flags.has('--dry-run');
const QUIET = flags.has('--quiet');
const log = (...a) => { if (!QUIET) console.error(...a); };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CONFIG_PATH = process.env.SYNC_CONFIG || path.join(ROOT, 'sync.config.json');

const ACTIVITY_EXT = /\.(fit|gpx|tcx)(\.gz)?$/i;

/** Collect { name, read() } sources plus the export CSV from the given inputs. */
async function collect(inputPaths) {
  const files = [];
  let csvText = null;
  for (const input of inputPaths) {
    const stat = await fs.stat(input);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(input, { recursive: true, withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const full = path.join(e.parentPath ?? e.path, e.name);
        if (e.name.toLowerCase() === 'activities.csv' && !csvText) csvText = await fs.readFile(full, 'utf8');
        else if (ACTIVITY_EXT.test(e.name)) files.push({ name: path.relative(input, full).split(path.sep).join('/'), read: () => fs.readFile(full) });
      }
    } else if (/\.zip$/i.test(input)) {
      const buf = await fs.readFile(input);
      for (const e of readZipEntries(buf)) {
        if (e.isDirectory) continue;
        const base = e.name.split('/').pop();
        if (base.toLowerCase() === 'activities.csv' && !csvText) csvText = e.read().toString('utf8');
        else if (ACTIVITY_EXT.test(base)) files.push({ name: e.name, read: async () => e.read() });
      }
    } else if (/\.csv$/i.test(input)) {
      csvText = await fs.readFile(input, 'utf8');
    } else if (ACTIVITY_EXT.test(input)) {
      files.push({ name: path.basename(input), read: () => fs.readFile(input) });
    } else {
      log(`Skipping ${input}: not a zip, folder, csv or activity file.`);
    }
  }
  return { files, csvText };
}

/** Strava CSV "Aug 24, 2024, 10:47:26 AM" -> Date (the export uses UTC). */
function parseCsvDate(s) {
  const m = String(s || '').match(/^(\w{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hour = Number(m[4]) % 12;
  if (m[7] === 'PM') hour += 12;
  return new Date(Date.UTC(Number(m[3]), months.indexOf(m[1]), Number(m[2]), hour, Number(m[5]), Number(m[6])));
}

const csvNum = (s) => {
  if (s === undefined || s === null || s === '') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Index entry for a CSV row that has no file (manual / indoor entries). */
function entryFromCsvRow(row, timeZone) {
  const start = parseCsvDate(row['Activity Date']);
  if (!start) return null;
  const { sport_type, trainer } = normalizeSportType(row['Activity Type']);
  const offset = timeZone ? tzOffsetSeconds(start, timeZone) : 0;
  const distance = csvNum(row['Distance#2']) ?? (csvNum(row['Distance']) ?? 0) * 1000;
  const elapsed = csvNum(row['Elapsed Time#2']) ?? csvNum(row['Elapsed Time']) ?? 0;
  const moving = csvNum(row['Moving Time']) ?? elapsed;
  const avgHr = csvNum(row['Average Heart Rate']);
  return {
    id: Number(row['Activity ID']),
    name: row['Activity Name'] || sport_type,
    type: sport_type === 'TrailRun' || sport_type === 'VirtualRun' ? 'Run' : sport_type,
    sport_type,
    workout_type: null,
    start_date: start.toISOString(),
    start_date_local: new Date(start.getTime() + offset * 1000).toISOString(),
    timezone: timeZone || null,
    utc_offset: offset,
    distance: round(distance, 1),
    moving_time: Math.round(moving),
    elapsed_time: Math.round(elapsed),
    total_elevation_gain: round(csvNum(row['Elevation Gain']) ?? 0, 1),
    elev_high: csvNum(row['Elevation High']),
    elev_low: csvNum(row['Elevation Low']),
    average_speed: round(moving > 0 ? distance / moving : 0, 3),
    max_speed: round(csvNum(row['Max Speed']), 3),
    has_heartrate: avgHr !== null,
    average_heartrate: round(avgHr, 1),
    max_heartrate: csvNum(row['Max Heart Rate']),
    average_cadence: round(csvNum(row['Average Cadence']), 1),
    average_temp: csvNum(row['Average Temperature']),
    trainer,
    commute: /true|1/i.test(row['Commute'] || ''),
    manual: true,
    private: false,
    visibility: 'only_me',
    gear_id: null,
    external_id: null,
    upload_id: null,
    device_name: null,
    source: 'csv',
    has_details: false,
    has_streams: false,
  };
}

async function main() {
  if (!inputs.length) {
    console.error('Usage: node scripts/ingest.mjs <export.zip | folder | file ...> [--force] [--dry-run]');
    process.exit(2);
  }
  const config = await readJson(CONFIG_PATH, {});
  const timeZone = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const streamTypes = new Set(config.activityTypes || ['Run', 'TrailRun', 'VirtualRun']);
  const assembleCfg = { privacy: config.privacy, hrZones: config.athlete?.hrZones || null, elevationThreshold: config.elevationThreshold ?? 2 };
  const paths = dataPaths(DATA_DIR);

  const { files, csvText } = await collect(inputs);
  const csv = csvText ? parseCsv(csvText) : null;
  const rowsByFile = new Map();
  const rowsWithoutFile = [];
  if (csv) {
    for (const row of csv.records) {
      const f = (row['Filename'] || '').trim();
      if (f) rowsByFile.set(f.split('/').pop(), row);
      else if (row['Activity ID']) rowsWithoutFile.push(row);
    }
    log(`activities.csv: ${csv.records.length} rows (${rowsByFile.size} with files, ${rowsWithoutFile.length} without).`);
  }
  log(`${files.length} activity files to consider.`);

  const index = await readJson(paths.index, []);
  const byId = new Map(index.map((a) => [a.id, a]));
  const stats = { added: 0, updated: 0, skipped: 0, failed: 0, csvOnly: 0 };
  const failures = [];
  let sinceFlush = 0;

  const upsert = (entry) => {
    const existed = byId.has(entry.id);
    byId.set(entry.id, entry);
    if (existed) stats.updated += 1;
    else stats.added += 1;
  };
  const flush = async () => {
    if (DRY_RUN) return;
    await writeIndex(paths.index, [...byId.values()].sort(byStartDesc));
    sinceFlush = 0;
  };

  for (const file of files) {
    const base = file.name.split('/').pop();
    const row = rowsByFile.get(base);
    const csvId = row ? Number(row['Activity ID']) : null;
    if (csvId && byId.has(csvId) && byId.get(csvId).has_streams && !FORCE) {
      stats.skipped += 1;
      continue;
    }
    try {
      let bytes = await file.read();
      if (/\.gz$/i.test(base)) bytes = zlib.gunzipSync(bytes);
      let a;
      if (/\.fit(\.gz)?$/i.test(base)) a = parseFit(bytes);
      else if (/\.gpx(\.gz)?$/i.test(base)) a = parseGpx(bytes.toString('utf8'));
      else if (/\.tcx(\.gz)?$/i.test(base)) a = parseTcx(bytes.toString('utf8'));
      if (!a) {
        stats.skipped += 1;
        log(`${file.name}: no activity data, skipped.`);
        continue;
      }
      a.id = csvId || Math.floor(a.start.getTime() / 1000);
      a.externalId = file.name;
      if (row) {
        a.name = row['Activity Name'] || a.name;
        a.description = row['Activity Description'] || null;
        a.gear = row['Activity Gear'] || null;
        a.perceivedExertion = csvNum(row['Perceived Exertion']);
        a.commute = /true|1/i.test(row['Commute'] || '');
        const t = normalizeSportType(row['Activity Type']);
        if (row['Activity Type']) {
          a.stravaSportType = t.sport_type;
          a.stravaType = t.sport_type === 'TrailRun' || t.sport_type === 'VirtualRun' ? 'Run' : t.sport_type === 'VirtualRide' ? 'Ride' : t.sport_type;
        }
      }
      if (a.utcOffset === null || a.utcOffset === undefined) {
        a.utcOffset = tzOffsetSeconds(a.start, timeZone);
        a.timezone = timeZone;
      }
      if (!FORCE && byId.has(a.id) && byId.get(a.id).has_streams) {
        stats.skipped += 1;
        continue;
      }
      const { index: entry, detail, streams } = assemble(a, assembleCfg);
      const wantStreams = streamTypes.has(entry.sport_type) && entry.has_streams;
      entry.has_streams = wantStreams;
      if (!DRY_RUN) {
        await writeJson(paths.detail(entry.id), detail);
        if (wantStreams) await writeJson(paths.streams(entry.id), streams);
      }
      upsert(entry);
      if (a.decodeErrors?.length) log(`${file.name}: decoded with warnings: ${a.decodeErrors.slice(0, 2).join('; ')}`);
      sinceFlush += 1;
      if (sinceFlush >= 25) await flush();
    } catch (err) {
      stats.failed += 1;
      failures.push(`${file.name}: ${err.message}`);
      log(`${file.name}: FAILED: ${err.message}`);
    }
  }

  for (const row of rowsWithoutFile) {
    const entry = entryFromCsvRow(row, timeZone);
    if (!entry || !entry.id) continue;
    if (byId.has(entry.id) && !FORCE) {
      stats.skipped += 1;
      continue;
    }
    upsert(entry);
    stats.csvOnly += 1;
  }

  await flush();
  if (!DRY_RUN) {
    const state = await readJson(paths.state, {});
    await writeJson(paths.state, {
      ...state,
      last_ingest: new Date().toISOString(),
      last_ingest_stats: stats,
      last_ingest_failures: failures.slice(0, 20),
      activities: byId.size,
    }, { pretty: true });
  }
  const all = [...byId.values()];
  console.error(`Ingest done: ${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.failed} failed (${stats.csvOnly} from CSV only). Index now has ${all.length} activities.${DRY_RUN ? ' (dry run, nothing written)' : ''}`);
  if (failures.length && stats.added + stats.updated === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

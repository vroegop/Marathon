import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeFit, makeGpx, makeZip, CSV_HEADER, csvRow } from './helpers/make-export.mjs';
import { readZipEntries } from '../scripts/lib/zip.mjs';
import { parseCsv } from '../scripts/lib/csv.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const INGEST = path.join(ROOT, 'scripts', 'ingest.mjs');
const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));

function runIngest({ dataDir, args, configPath }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [INGEST, ...args], { env: { ...process.env, DATA_DIR: dataDir, SYNC_CONFIG: configPath || path.join(ROOT, 'sync.config.json') } });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function buildExport(dir) {
  const fit = makeFit();
  const gpx = makeGpx();
  const csv = [
    CSV_HEADER,
    csvRow({ 'Activity ID': '12271989718', 'Activity Date': 'Jun 14, 2026, 6:30:00 AM', 'Activity Name': 'Morning Run', 'Activity Type': 'Run', 'Activity Description': 'Easy, felt "good"', 'Activity Gear': 'Pegasus 41', Filename: 'activities/13083291667.fit.gz', 'Perceived Exertion': '3', 'Elapsed Time': '2400', Distance: '7.42' }),
    csvRow({ 'Activity ID': '12345', 'Activity Date': 'Jun 20, 2026, 5:00:00 PM', 'Activity Name': 'Evening Trail', 'Activity Type': 'Trail Run', Filename: 'activities/999.gpx' }),
    csvRow({ 'Activity ID': '777', 'Activity Date': 'Jun 21, 2026, 7:15:00 AM', 'Activity Name': 'Treadmill', 'Activity Type': 'Run', 'Elapsed Time': '1,500', Distance: '5.00', 'Elapsed Time#2': '1500', 'Moving Time': '1480', 'Distance#2': '5000.0', 'Average Heart Rate': '142', 'Max Heart Rate': '160', 'Elevation Gain': '0' }),
    csvRow({ 'Activity ID': '778', 'Activity Date': 'Jun 22, 2026, 7:15:00 AM', 'Activity Name': 'Gym', 'Activity Type': 'Weight Training', 'Elapsed Time#2': '3600', 'Distance#2': '0' }),
  ].join('\n');
  const zip = makeZip([
    { name: 'activities.csv', data: csv },
    { name: 'activities/13083291667.fit.gz', data: zlib.gzipSync(fit.bytes) },
    { name: 'activities/999.gpx', data: gpx },
    { name: 'profile.csv', data: 'a,b\n1,2\n' },
  ]);
  const zipPath = path.join(dir, 'export_1.zip');
  await fs.writeFile(zipPath, zip);
  return { zipPath, fit };
}

test('zip reader and csv parser round-trip', async () => {
  const buf = makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.csv', data: 'x,y\n"1,5",2\n' }]);
  const entries = readZipEntries(buf);
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/b.csv']);
  assert.equal(entries[0].read().toString(), 'hello');
  const csv = parseCsv(entries[1].read().toString());
  assert.deepEqual(csv.records, [{ x: '1,5', y: '2' }]);
  const dup = parseCsv('a,b,a\n1,2,3\n');
  assert.deepEqual(dup.records, [{ a: '1', b: '2', 'a#2': '3' }]);
});

test('ingests a Strava export zip: FIT, GPX and CSV-only activities', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-ingest-'));
  const dataDir = path.join(dir, 'data');
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ activityTypes: ['Run', 'TrailRun', 'VirtualRun'], timezone: 'Europe/Amsterdam', athlete: { hrZones: [[0, 120], [120, 150], [150, 165], [165, 180], [180, -1]] } }));
  try {
    const { zipPath, fit } = await buildExport(dir);
    const r = await runIngest({ dataDir, args: [zipPath], configPath });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /4 added/);

    const index = await readJson(path.join(dataDir, 'activities.json'));
    assert.deepEqual(index.map((a) => a.id), [778, 777, 12345, 12271989718]);

    const run = index.find((a) => a.id === 12271989718);
    assert.equal(run.name, 'Morning Run');
    assert.equal(run.sport_type, 'Run');
    assert.equal(run.source, 'fit');
    assert.equal(run.device_name, 'OnePlus Watch 3');
    assert.equal(run.utc_offset, 7200);
    assert.equal(run.start_date, '2026-06-14T06:30:00.000Z');
    assert.equal(run.start_date_local, '2026-06-14T08:30:00.000Z');
    assert.ok(Math.abs(run.distance - fit.expected.distance) < 1, `distance ${run.distance} vs ${fit.expected.distance}`);
    assert.equal(run.elapsed_time, fit.expected.elapsed);
    assert.equal(run.moving_time, fit.expected.timer);
    assert.equal(run.has_heartrate, true);
    assert.equal(run.max_heartrate, fit.expected.maxHr);
    assert.ok(Math.abs(run.average_heartrate - fit.expected.avgHr) < 1);
    assert.equal(run.total_elevation_gain, 12);
    assert.equal(run.has_streams, true);
    assert.equal(run.has_details, true);
    assert.equal(run.external_id, 'activities/13083291667.fit.gz');
    assert.ok(!('start_latlng' in run));

    const streams = await readJson(path.join(dataDir, 'streams', '12271989718.json'));
    assert.equal(streams.time.length, fit.expected.samples);
    assert.equal(streams.time[0], 0);
    assert.equal(streams.time[streams.time.length - 1], 2400);
    assert.ok(!('lat' in streams) && !('lng' in streams), 'GPS stripped by default');
    assert.ok(streams.heartrate.every((h) => h >= 130 && h <= 170));
    assert.ok(streams.altitude.length === streams.time.length);
    assert.ok(streams.grade_smooth.length === streams.time.length);
    assert.ok(streams.velocity_smooth.every((v) => v > 2.5 && v < 3.6));
    assert.equal(streams.cadence[0], 85);
    assert.equal(streams.temp[0], 14);

    const detail = await readJson(path.join(dataDir, 'activities', '12271989718.json'));
    assert.equal(detail.description, 'Easy, felt "good"');
    assert.equal(detail.gear.name, 'Pegasus 41');
    assert.equal(detail.perceived_exertion, 3);
    assert.equal(detail.calories, 500);
    assert.equal(detail.laps.length, fit.expected.laps);
    assert.equal(detail.laps[0].trigger, 'distance');
    assert.ok(Math.abs(detail.laps[0].distance - 1000) < 5);
    assert.equal(detail.splits_metric.length, Math.ceil(fit.expected.distance / 1000));
    const s1 = detail.splits_metric[0];
    assert.ok(s1.elapsed_time > 300 && s1.elapsed_time < 340, `split 1 elapsed ${s1.elapsed_time}`);
    assert.ok(s1.average_speed > 2.9 && s1.average_speed < 3.4);
    assert.ok(s1.average_grade_adjusted_speed > 2.5);
    assert.ok(s1.average_heartrate > 130);
    const pauseSplit = detail.splits_metric.find((s) => s.elapsed_time - s.moving_time >= 55);
    assert.ok(pauseSplit, 'the split containing the pause shows elapsed > moving');
    assert.ok(detail.best_efforts.some((e) => e.name === '5k'));
    assert.ok(!detail.best_efforts.some((e) => e.name === '10k'));
    const k1 = detail.best_efforts.find((e) => e.name === '1k');
    assert.ok(k1.elapsed_time > 290 && k1.elapsed_time < 340);
    assert.equal(detail.zones[0].type, 'heartrate');
    assert.equal(detail.zones[0].distribution_buckets.reduce((s, b) => s + b.time, 0), 2400);
    assert.equal(detail.device.product, 'OnePlus Watch 3');

    const trail = index.find((a) => a.id === 12345);
    assert.equal(trail.sport_type, 'TrailRun');
    assert.equal(trail.type, 'Run');
    assert.equal(trail.source, 'gpx');
    assert.ok(trail.distance > 1200 && trail.distance < 1400, `gpx distance ${trail.distance}`);
    assert.equal(trail.has_heartrate, true);
    assert.equal(trail.utc_offset, 7200, 'Europe/Amsterdam in June');
    assert.equal(trail.elapsed_time, 600);
    const trailStreams = await readJson(path.join(dataDir, 'streams', '12345.json'));
    assert.equal(trailStreams.time.length, 301);
    assert.ok(trailStreams.distance[300] > 1200);

    const treadmill = index.find((a) => a.id === 777);
    assert.equal(treadmill.manual, true);
    assert.equal(treadmill.distance, 5000);
    assert.equal(treadmill.elapsed_time, 1500);
    assert.equal(treadmill.moving_time, 1480);
    assert.equal(treadmill.average_heartrate, 142);
    assert.equal(treadmill.has_streams, false);
    assert.equal(treadmill.has_details, false);
    assert.equal(treadmill.source, 'csv');
    assert.equal(treadmill.start_date, '2026-06-21T07:15:00.000Z');
    const gym = index.find((a) => a.id === 778);
    assert.equal(gym.sport_type, 'WeightTraining');

    const state = await readJson(path.join(dataDir, 'sync-state.json'));
    assert.equal(state.activities, 4);
    assert.equal(state.last_ingest_stats.failed, 0);

    // second run: everything skipped, files untouched
    const before = await fs.stat(path.join(dataDir, 'streams', '12271989718.json'));
    const r2 = await runIngest({ dataDir, args: [zipPath], configPath });
    assert.equal(r2.code, 0, r2.stderr);
    assert.match(r2.stderr, /0 added, 0 updated, 4 skipped/);
    const after = await fs.stat(path.join(dataDir, 'streams', '12271989718.json'));
    assert.equal(after.mtimeMs, before.mtimeMs);

    // --force re-processes, keeps the same ids
    const r3 = await runIngest({ dataDir, args: [zipPath, '--force'], configPath });
    assert.equal(r3.code, 0, r3.stderr);
    assert.match(r3.stderr, /0 added, 4 updated/);
    const index3 = await readJson(path.join(dataDir, 'activities.json'));
    assert.deepEqual(index3.map((a) => a.id), [778, 777, 12345, 12271989718]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('ingests loose files without a CSV, keeps GPS when configured, honours dry-run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-ingest-'));
  const dataDir = path.join(dir, 'data');
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ activityTypes: ['Run'], timezone: 'UTC', privacy: { keepLatLng: true } }));
  try {
    const fit = makeFit({ start: new Date('2026-07-01T05:00:00Z') });
    const folder = path.join(dir, 'files');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'watch.fit'), fit.bytes);
    await fs.writeFile(path.join(folder, 'phone.gpx'), makeGpx());
    const dry = await runIngest({ dataDir, args: [folder, '--dry-run'], configPath });
    assert.equal(dry.code, 0, dry.stderr);
    await assert.rejects(fs.stat(path.join(dataDir, 'activities.json')));

    const r = await runIngest({ dataDir, args: [folder], configPath });
    assert.equal(r.code, 0, r.stderr);
    const index = await readJson(path.join(dataDir, 'activities.json'));
    assert.equal(index.length, 2);
    const run = index.find((a) => a.source === 'fit');
    assert.equal(run.id, Math.floor(Date.parse('2026-07-01T05:00:00Z') / 1000), 'id derived from the start time');
    assert.equal(run.name, 'Run 2026-07-01');
    assert.equal(run.utc_offset, 7200, 'offset comes from the FIT activity message');
    const streams = await readJson(path.join(dataDir, 'streams', `${run.id}.json`));
    assert.ok(Array.isArray(streams.lat) && streams.lat[0] > 52 && streams.lat[0] < 53);
    const detail = await readJson(path.join(dataDir, 'activities', `${run.id}.json`));
    assert.ok(Array.isArray(detail.start_latlng));
    const gpx = index.find((a) => a.source === 'gpx');
    assert.equal(gpx.name, 'Evening Trail');
    assert.equal(gpx.utc_offset, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

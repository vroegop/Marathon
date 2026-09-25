import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMockStrava, makeActivity } from './mock-strava.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SYNC = path.join(ROOT, 'scripts', 'strava-sync.mjs');

async function runSync({ mock, dataDir, args = [], refreshToken = 'refresh-ok', configPath }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SYNC, ...args], {
      env: {
        ...process.env,
        STRAVA_CLIENT_ID: 'id',
        STRAVA_CLIENT_SECRET: 'secret',
        STRAVA_REFRESH_TOKEN: refreshToken,
        STRAVA_API_BASE: mock.apiBase,
        STRAVA_TOKEN_URL: mock.tokenUrl,
        DATA_DIR: dataDir,
        SYNC_CONFIG: configPath || path.join(ROOT, 'sync.config.json'),
        GITHUB_OUTPUT: '',
        GITHUB_STEP_SUMMARY: '',
      },
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));

test('full sync writes index, details and streams; second run is idempotent', async () => {
  const activities = [
    ...Array.from({ length: 5 }, (_, i) => makeActivity(i)),
    makeActivity(5, { type: 'Ride' }),
    { ...makeActivity(6), manual: true, has_heartrate: false },
  ];
  const mock = await startMockStrava({ activities });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-'));
  try {
    const r = await runSync({ mock, dataDir });
    assert.equal(r.code, 0, r.stderr);

    const index = await readJson(path.join(dataDir, 'activities.json'));
    assert.equal(index.length, 7);
    assert.equal(index[0].id, 1006, 'newest first');
    assert.ok(index.every((a) => a.has_details));
    assert.ok(index.every((a) => !('start_latlng' in a) && !('map' in a) && !('athlete' in a)));
    const ride = index.find((a) => a.id === 1005);
    assert.equal(ride.has_streams, false, 'streams only for configured types');
    assert.equal(index.find((a) => a.id === 1000).device_name, 'OnePlus Watch 3');

    const detail = await readJson(path.join(dataDir, 'activities', '1000.json'));
    assert.equal(detail.splits_metric.length, 10);
    assert.equal(detail.laps.length, 1);
    assert.equal(detail.zones[0].type, 'heartrate');
    assert.ok(!('segment_efforts' in detail) && !('start_latlng' in detail) && !('map' in detail) && !('location_city' in detail));
    assert.equal(detail.description, 'easy');

    const streams = await readJson(path.join(dataDir, 'streams', '1000.json'));
    assert.equal(streams.activity_id, 1000);
    assert.equal(streams.time.length, 600);
    assert.ok(!('lat' in streams) && !('latlng' in streams), 'latlng stripped by default');
    assert.equal(streams.altitude[1], Number(streams.altitude[1].toFixed(1)));
    assert.equal(streams.moving[0], 0);
    assert.equal(streams.moving[1], 1);

    // manual activity has no streams (404) and must not be retried forever
    assert.equal(index.find((a) => a.id === 1006).has_streams, true);
    await assert.rejects(fs.stat(path.join(dataDir, 'streams', '1006.json')));

    const state = await readJson(path.join(dataDir, 'sync-state.json'));
    assert.equal(state.pending_details, 0);
    assert.equal(state.pending_streams, 0);
    assert.equal(state.stopped_early, null);

    // second run: incremental listing only, no detail/stream fetches
    const before = mock.state.requests.length;
    const r2 = await runSync({ mock, dataDir });
    assert.equal(r2.code, 0, r2.stderr);
    const newRequests = mock.state.requests.slice(before);
    assert.ok(newRequests.every((q) => q.includes('/oauth/token') || q.includes('/athlete/activities')), newRequests.join('\n'));
    const index2 = await readJson(path.join(dataDir, 'activities.json'));
    assert.deepEqual(index2, index);
  } finally {
    await mock.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('stops gracefully when the rate limit is hit and resumes on the next run', async () => {
  const activities = Array.from({ length: 12 }, (_, i) => makeActivity(i));
  // 3 requests per activity (detail, zones, streams) + 1 listing; allow ~5 activities per window
  const mock = await startMockStrava({ activities, readLimit15: 22 });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-'));
  try {
    const r = await runSync({ mock, dataDir, args: ['--no-wait'] });
    assert.equal(r.code, 0, r.stderr);
    const state = await readJson(path.join(dataDir, 'sync-state.json'));
    assert.ok(state.stopped_early, 'should report early stop');
    assert.ok(state.pending_details > 0 && state.pending_details < 12);
    const index = await readJson(path.join(dataDir, 'activities.json'));
    const done = index.filter((a) => a.has_details && a.has_streams).length;
    assert.ok(done >= 4 && done <= 6, `done=${done}`);
    assert.ok(!mock.state.requests.some((q) => q.includes('activities/1000/')), 'oldest activity not fetched yet');
    assert.ok(!mock.state.requests.some((q) => q.includes('/laps')), 'laps come with the detail, no extra request');

    // following runs: each in a new 15-min window
    let runs = 1;
    let state2 = state;
    while (state2.pending_details + state2.pending_streams > 0 && runs < 5) {
      mock.state.reads = 0;
      const r2 = await runSync({ mock, dataDir, args: ['--no-wait'] });
      assert.equal(r2.code, 0, r2.stderr);
      state2 = await readJson(path.join(dataDir, 'sync-state.json'));
      runs += 1;
    }
    assert.equal(state2.pending_details, 0);
    assert.equal(state2.pending_streams, 0);
    assert.ok(runs >= 2 && runs <= 4, `runs=${runs}`);
    const index2 = await readJson(path.join(dataDir, 'activities.json'));
    assert.ok(index2.every((a) => a.has_details && a.has_streams));
    assert.ok(await fs.stat(path.join(dataDir, 'streams', '1000.json')));
  } finally {
    await mock.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('removes activities deleted on Strava, adds new ones, and keeps lat/lng when configured', async () => {
  const activities = Array.from({ length: 3 }, (_, i) => makeActivity(i));
  const mock = await startMockStrava({ activities });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-'));
  const configPath = path.join(dataDir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ activityTypes: ['Run'], privacy: { keepLatLng: true, keepLocationNames: true }, zones: false }));
  try {
    const r = await runSync({ mock, dataDir, configPath });
    assert.equal(r.code, 0, r.stderr);
    const streams = await readJson(path.join(dataDir, 'streams', '1000.json'));
    assert.ok(Array.isArray(streams.lat) && Array.isArray(streams.lng));
    const detail = await readJson(path.join(dataDir, 'activities', '1000.json'));
    assert.deepEqual(detail.start_latlng, [52.37, 4.89]);
    assert.equal(detail.map.summary_polyline, 'abc');
    assert.equal(detail.location_city, 'Amsterdam');
    assert.ok(!('zones' in detail));

    // delete one, add one (newer)
    mock.state.activities = mock.state.activities.filter((a) => a.id !== 1001);
    mock.state.activities.push(makeActivity(50, { startMs: Date.now() - 3600_000 }));
    const r2 = await runSync({ mock, dataDir, configPath, args: ['--full'] });
    assert.equal(r2.code, 0, r2.stderr);
    const index = await readJson(path.join(dataDir, 'activities.json'));
    assert.deepEqual(index.map((a) => a.id), [1050, 1002, 1000]);
    await assert.rejects(fs.stat(path.join(dataDir, 'activities', '1001.json')));
    await assert.rejects(fs.stat(path.join(dataDir, 'streams', '1001.json')));
    assert.ok(await fs.stat(path.join(dataDir, 'streams', '1050.json')));
  } finally {
    await mock.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('fails clearly with a bad refresh token', async () => {
  const mock = await startMockStrava({ activities: [makeActivity(0)] });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-'));
  try {
    const r = await runSync({ mock, dataDir, refreshToken: 'bad' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Token refresh failed \(400\)/);
  } finally {
    await mock.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('remembers that activity zones need a subscription and stops requesting them', async () => {
  const activities = Array.from({ length: 4 }, (_, i) => makeActivity(i));
  const mock = await startMockStrava({ activities });
  mock.state.forbidZones = true;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marathon-'));
  try {
    const r = await runSync({ mock, dataDir });
    assert.equal(r.code, 0, r.stderr);
    const zoneRequests = mock.state.requests.filter((q) => q.includes('/zones'));
    assert.equal(zoneRequests.length, 1, 'only the first activity asks for zones');
    const state = await readJson(path.join(dataDir, 'sync-state.json'));
    assert.equal(state.zones_available, false);
    const detail = await readJson(path.join(dataDir, 'activities', '1003.json'));
    assert.ok(!('zones' in detail));
    assert.equal(detail.laps.length, 1);

    // a later run with a new activity does not ask again
    mock.state.activities.push(makeActivity(9, { startMs: Date.now() - 3600_000 }));
    const r2 = await runSync({ mock, dataDir });
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(mock.state.requests.filter((q) => q.includes('/zones')).length, 1);
  } finally {
    await mock.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

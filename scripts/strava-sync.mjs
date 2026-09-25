#!/usr/bin/env node
// Incremental Strava -> repo sync.
//
//   node scripts/strava-sync.mjs [--full] [--no-streams] [--max-requests N] [--no-wait] [--dry-run]
//
// Environment:
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN   (required)
//   DATA_DIR            where to write (default: ./data)
//   STRAVA_API_BASE     override for tests (default: https://www.strava.com/api/v3)
//   STRAVA_TOKEN_URL    override for tests
//
// What it produces (see docs/data-format.md):
//   data/activities.json        index of every activity (summary fields, one line each)
//   data/activities/<id>.json   detailed activity: splits, laps, best efforts, zones
//   data/streams/<id>.json      per-second streams for configured activity types
//   data/sync-state.json        bookkeeping: last run, pending work, rate-limit usage
//
// The script is idempotent and resumable: it always re-lists all activities
// (cheap: 200 per request), then fetches details/streams only for activities
// that do not have them yet, newest first, until the Strava rate-limit budget
// for this run is spent. Re-run it (the GitHub Action does, nightly) until
// sync-state.json reports zero pending.

import fs from 'node:fs/promises';
import path from 'node:path';
import { StravaClient, BudgetExhausted, StravaError } from './lib/strava.mjs';
import { readJson, writeJson as storeWriteJson, writeIndex as storeWriteIndex } from './lib/store.mjs';

const args = new Set(process.argv.slice(2));
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FULL = args.has('--full');
const NO_STREAMS = args.has('--no-streams');
const NO_WAIT = args.has('--no-wait');
const DRY_RUN = args.has('--dry-run');
const MAX_REQUESTS = argValue('--max-requests') ? Number(argValue('--max-requests')) : Infinity;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CONFIG_PATH = process.env.SYNC_CONFIG || path.join(ROOT, 'sync.config.json');

const log = (...a) => console.error(...a);

const writeJson = (file, value, opts) => (DRY_RUN ? Promise.resolve() : storeWriteJson(file, value, opts));
const writeIndex = (file, activities) => (DRY_RUN ? Promise.resolve() : storeWriteIndex(file, activities));

const round = (n, d) => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(d)) : n);

const SUMMARY_FIELDS = [
  'id', 'name', 'type', 'sport_type', 'workout_type', 'start_date', 'start_date_local', 'timezone', 'utc_offset',
  'distance', 'moving_time', 'elapsed_time', 'total_elevation_gain', 'elev_high', 'elev_low',
  'average_speed', 'max_speed', 'has_heartrate', 'average_heartrate', 'max_heartrate', 'average_cadence',
  'average_temp', 'suffer_score', 'trainer', 'commute', 'manual', 'private', 'visibility', 'gear_id',
  'external_id', 'upload_id', 'device_name',
];

function summarize(a, existing = {}) {
  const out = {};
  for (const f of SUMMARY_FIELDS) if (a[f] !== undefined) out[f] = a[f];
  out.distance = round(out.distance, 1);
  out.average_speed = round(out.average_speed, 3);
  out.max_speed = round(out.max_speed, 3);
  out.total_elevation_gain = round(out.total_elevation_gain, 1);
  out.average_heartrate = round(out.average_heartrate, 1);
  out.average_cadence = round(out.average_cadence, 1);
  // flags maintained by this script
  out.has_details = existing.has_details || false;
  out.has_streams = existing.has_streams || false;
  if (existing.device_name && !out.device_name) out.device_name = existing.device_name;
  return out;
}

const DETAIL_DROP_ALWAYS = new Set([
  'athlete', 'photos', 'stats_visibility', 'segment_efforts', 'splits_standard', 'similar_activities',
  'available_zones', 'embed_token', 'partner_brand_tag', 'partner_logo_url', 'highlighted_kudosers',
  'resource_state', 'map', 'total_photo_count', 'has_kudoed', 'kudos_count', 'comment_count', 'athlete_count',
  'photo_count', 'display_hide_heartrate_option', 'heartrate_opt_out', 'from_accepted_tag', 'pr_count',
  'achievement_count', 'flagged', 'hide_from_home', 'upload_id_str', 'laps',
]);
const LOCATION_FIELDS = ['start_latlng', 'end_latlng', 'location_city', 'location_state', 'location_country'];

function trimDetail(d, privacy) {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (DETAIL_DROP_ALWAYS.has(k)) continue;
    if (LOCATION_FIELDS.includes(k) && !(k.endsWith('latlng') ? privacy.keepLatLng : privacy.keepLocationNames)) continue;
    if (k === 'description' && !privacy.keepDescription) continue;
    out[k] = v;
  }
  if (privacy.keepLatLng && d.map?.summary_polyline) out.map = { summary_polyline: d.map.summary_polyline };
  if (Array.isArray(out.splits_metric)) {
    out.splits_metric = out.splits_metric.map((s) => ({
      split: s.split,
      distance: round(s.distance, 1),
      elapsed_time: s.elapsed_time,
      moving_time: s.moving_time,
      elevation_difference: round(s.elevation_difference, 1),
      average_speed: round(s.average_speed, 3),
      average_grade_adjusted_speed: round(s.average_grade_adjusted_speed, 3),
      average_heartrate: round(s.average_heartrate, 1),
      pace_zone: s.pace_zone,
    }));
  }
  if (Array.isArray(out.best_efforts)) {
    out.best_efforts = out.best_efforts.map((e) => ({
      name: e.name,
      distance: e.distance,
      elapsed_time: e.elapsed_time,
      moving_time: e.moving_time,
      start_date_local: e.start_date_local,
      start_index: e.start_index,
      end_index: e.end_index,
      pr_rank: e.pr_rank,
    }));
  }
  if (out.gear) out.gear = { id: out.gear.id, name: out.gear.name, distance: out.gear.distance };
  return out;
}

function trimLaps(laps) {
  return laps.map((l) => ({
    lap_index: l.lap_index,
    split: l.split,
    name: l.name,
    distance: round(l.distance, 1),
    elapsed_time: l.elapsed_time,
    moving_time: l.moving_time,
    start_date_local: l.start_date_local,
    start_index: l.start_index,
    end_index: l.end_index,
    average_speed: round(l.average_speed, 3),
    max_speed: round(l.max_speed, 3),
    average_heartrate: round(l.average_heartrate, 1),
    max_heartrate: l.max_heartrate,
    average_cadence: round(l.average_cadence, 1),
    total_elevation_gain: round(l.total_elevation_gain, 1),
    pace_zone: l.pace_zone,
  }));
}

function trimZones(zones) {
  // Strava returns an array of { type: 'heartrate'|'power'|'pace', distribution_buckets: [{min,max,time}], ... }
  return zones.map((z) => ({
    type: z.type,
    sensor_based: z.sensor_based,
    custom_zones: z.custom_zones,
    points: z.points,
    distribution_buckets: (z.distribution_buckets || []).map((b) => ({ min: b.min, max: b.max, time: b.time })),
  }));
}

const STREAM_PRECISION = {
  time: 0, distance: 1, altitude: 1, velocity_smooth: 3, heartrate: 0, cadence: 0, grade_smooth: 1, temp: 0, watts: 0,
};

function compactStreams(raw, privacy) {
  // raw is key_by_type=true: { time: { data: [...], series_type, original_size, resolution }, ... }
  const out = { series_type: null, original_size: null, resolution: null };
  for (const [key, s] of Object.entries(raw)) {
    if (!s || !Array.isArray(s.data)) continue;
    if (key === 'latlng') {
      if (!privacy.keepLatLng) continue;
      out.lat = s.data.map((p) => round(p[0], 5));
      out.lng = s.data.map((p) => round(p[1], 5));
    } else if (key === 'moving') {
      out.moving = s.data.map((m) => (m ? 1 : 0));
    } else if (key in STREAM_PRECISION) {
      out[key] = s.data.map((v) => round(v, STREAM_PRECISION[key]));
    } else {
      out[key] = s.data;
    }
    out.series_type = out.series_type || s.series_type || null;
    out.original_size = out.original_size || s.original_size || null;
    out.resolution = out.resolution || s.resolution || null;
  }
  return out;
}

async function listAllActivities(client, { after } = {}) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const params = { per_page: 200, page };
    if (after) params.after = after;
    const batch = await client.get('athlete/activities', params);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}

async function main() {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
    log('Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN. See README.md ("Connect Strava").');
    process.exit(2);
  }
  const config = await readJson(CONFIG_PATH, {});
  const privacy = { keepLatLng: false, keepLocationNames: false, keepDescription: true, ...(config.privacy || {}) };
  const streamTypes = new Set(config.activityTypes || ['Run', 'TrailRun', 'VirtualRun']);
  const streamKeys = config.streams?.keys || ['time', 'distance', 'altitude', 'velocity_smooth', 'heartrate', 'cadence', 'grade_smooth', 'moving', 'temp', 'latlng'];
  const streamsEnabled = !NO_STREAMS && (config.streams?.enabled ?? true);

  const client = new StravaClient({
    clientId: STRAVA_CLIENT_ID,
    clientSecret: STRAVA_CLIENT_SECRET,
    refreshToken: STRAVA_REFRESH_TOKEN,
    apiBase: process.env.STRAVA_API_BASE,
    tokenUrl: process.env.STRAVA_TOKEN_URL,
    maxRequests: MAX_REQUESTS,
    maxWaitMs: NO_WAIT ? 0 : undefined,
    log,
  });

  const indexFile = path.join(DATA_DIR, 'activities.json');
  const stateFile = path.join(DATA_DIR, 'sync-state.json');
  const detailDir = path.join(DATA_DIR, 'activities');
  const streamDir = path.join(DATA_DIR, 'streams');

  const previous = await readJson(indexFile, []);
  const prevById = new Map(previous.map((a) => [a.id, a]));
  const state = await readJson(stateFile, {});
  const startedAt = new Date();
  const stats = { listed: 0, new: 0, removed: 0, details: 0, streams: 0, errors: 0 };

  // 1. List activities. Always a full listing unless the previous listing was
  //    complete and this is an incremental run; then re-list from 30 days
  //    before the last run so late uploads and edits are picked up.
  let after;
  if (!FULL && state.last_full_listing && previous.length > 0) {
    after = Math.floor(new Date(state.last_run || state.last_full_listing).getTime() / 1000) - 30 * 86400;
  }
  if (config.since) {
    const since = Math.floor(new Date(config.since).getTime() / 1000);
    after = after ? Math.max(after, since) : since;
  }
  log(after ? `Listing activities after ${new Date(after * 1000).toISOString()}...` : 'Listing all activities...');
  const listed = await listAllActivities(client, { after });
  stats.listed = listed.length;

  const listedIds = new Set(listed.map((a) => a.id));
  let index;
  if (after) {
    // merge: keep older entries, replace/add the re-listed window
    index = previous.filter((a) => {
      const t = Math.floor(new Date(a.start_date).getTime() / 1000);
      return t < after; // older than the window: keep as is
    });
    const windowPrev = previous.filter((a) => Math.floor(new Date(a.start_date).getTime() / 1000) >= after);
    stats.removed = windowPrev.filter((a) => !listedIds.has(a.id)).length;
    for (const a of listed) index.push(summarize(a, prevById.get(a.id)));
  } else {
    stats.removed = previous.filter((a) => !listedIds.has(a.id)).length;
    index = listed.map((a) => summarize(a, prevById.get(a.id)));
  }
  stats.new = listed.filter((a) => !prevById.has(a.id)).length;
  index.sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0));
  const indexById = new Map(index.map((a) => [a.id, a]));

  // Remove files of activities that disappeared from Strava.
  for (const a of previous) {
    if (indexById.has(a.id)) continue;
    log(`Activity ${a.id} (${a.name}) is gone from Strava; removing local files.`);
    if (!DRY_RUN) {
      await fs.rm(path.join(detailDir, `${a.id}.json`), { force: true });
      await fs.rm(path.join(streamDir, `${a.id}.json`), { force: true });
    }
  }

  if (!config.indexAllTypes) {
    index = index.filter((a) => streamTypes.has(a.sport_type || a.type));
  }
  await writeIndex(indexFile, index);
  if (!after) state.last_full_listing = startedAt.toISOString();
  log(`Index: ${index.length} activities (${stats.new} new, ${stats.removed} removed). ${client.usageSummary()}`);

  // 2. Details and streams, newest first, until the budget runs out.
  let budgetError = null;
  let zonesAvailable = state.zones_available !== false || FULL;
  try {
    for (const a of index) {
      const wantsStreams = streamsEnabled && streamTypes.has(a.sport_type || a.type);
      const needDetails = !a.has_details;
      const needStreams = wantsStreams && !a.has_streams;
      if (!needDetails && !needStreams) continue;

      if (needDetails) {
        try {
          const detail = await client.get(`activities/${a.id}`, { include_all_efforts: false });
          const trimmed = trimDetail(detail, privacy);
          if (config.laps !== false) {
            if (Array.isArray(detail.laps)) {
              trimmed.laps = trimLaps(detail.laps); // included in the detailed activity: no extra request
            } else {
              try {
                trimmed.laps = trimLaps(await client.get(`activities/${a.id}/laps`));
              } catch (err) {
                if (!(err instanceof StravaError)) throw err;
                log(`laps unavailable for ${a.id}: ${err.status}`);
              }
            }
          }
          if (config.zones !== false && zonesAvailable && detail.has_heartrate) {
            try {
              trimmed.zones = trimZones(await client.get(`activities/${a.id}/zones`));
            } catch (err) {
              if (!(err instanceof StravaError)) throw err;
              if (err.status === 402 || err.status === 403) {
                // Activity zones are a Strava-subscription feature: remember and stop asking.
                zonesAvailable = false;
                log('Activity zones are not available for this account (Strava subscription feature); skipping zones from now on.');
              } else if (err.status !== 404) {
                log(`zones unavailable for ${a.id}: ${err.status}`);
              }
            }
          }
          await writeJson(path.join(detailDir, `${a.id}.json`), trimmed);
          a.has_details = true;
          if (detail.device_name) a.device_name = detail.device_name;
          if (detail.workout_type !== undefined) a.workout_type = detail.workout_type;
          stats.details += 1;
        } catch (err) {
          if (err instanceof BudgetExhausted) throw err;
          if (err instanceof StravaError && err.status === 404) {
            log(`Activity ${a.id} not found (404); skipping.`);
            a.has_details = true; // do not retry forever
            continue;
          }
          stats.errors += 1;
          log(`Failed to fetch details for ${a.id}: ${err.message}`);
          continue;
        }
      }

      if (needStreams) {
        try {
          const raw = await client.get(`activities/${a.id}/streams`, { keys: streamKeys.join(','), key_by_type: true });
          const compact = compactStreams(raw || {}, privacy);
          compact.activity_id = a.id;
          await writeJson(path.join(streamDir, `${a.id}.json`), compact);
          a.has_streams = true;
          stats.streams += 1;
        } catch (err) {
          if (err instanceof BudgetExhausted) throw err;
          if (err instanceof StravaError && err.status === 404) {
            // manual activities / no GPS & sensors have no streams
            a.has_streams = true;
            continue;
          }
          stats.errors += 1;
          log(`Failed to fetch streams for ${a.id}: ${err.message}`);
        }
      }
      // Persist progress after each activity so an interrupted run loses nothing.
      await writeIndex(indexFile, index);
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) {
      budgetError = err;
      log(`Stopping early: ${err.message}`);
    } else {
      throw err;
    }
  }

  await writeIndex(indexFile, index);
  const pendingDetails = index.filter((a) => !a.has_details).length;
  const pendingStreams = index.filter((a) => streamsEnabled && streamTypes.has(a.sport_type || a.type) && !a.has_streams).length;
  const newState = {
    ...state,
    last_run: startedAt.toISOString(),
    last_run_finished: new Date().toISOString(),
    last_run_stats: stats,
    activities: index.length,
    pending_details: pendingDetails,
    pending_streams: pendingStreams,
    stopped_early: budgetError ? budgetError.message : null,
    rate_limit_usage: client.usage,
    requests_this_run: client.requestCount,
    refresh_token_rotated: client.refreshTokenChanged || undefined,
    zones_available: zonesAvailable,
  };
  await writeJson(stateFile, newState, { pretty: true });

  const summary = `Synced ${stats.details} details, ${stats.streams} streams (${stats.new} new activities). Pending: ${pendingDetails} details, ${pendingStreams} streams. Requests: ${client.requestCount}. ${client.usageSummary()}`;
  log(summary);
  if (process.env.GITHUB_OUTPUT) {
    const changed = stats.new + stats.removed + stats.details + stats.streams > 0 || FULL;
    await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\npending=${pendingDetails + pendingStreams}\nsummary=${summary}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Strava sync\n\n${summary}\n${budgetError ? `\n> Stopped early: ${budgetError.message}\n` : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

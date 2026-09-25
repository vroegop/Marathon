// A small fake of the Strava API for tests: token endpoint, activity listing,
// activity details, laps, zones and streams, with real-looking rate-limit headers.
import http from 'node:http';

export function makeActivity(i, { type = 'Run', startMs, distance = 10000 + i * 137, hr = true } = {}) {
  const start = new Date(startMs ?? Date.UTC(2026, 0, 1) + i * 86400000 * 2);
  const movingTime = Math.round(distance / 3.1);
  return {
    id: 1000 + i,
    name: `Morning Run ${i}`,
    type,
    sport_type: type,
    workout_type: 0,
    start_date: start.toISOString(),
    start_date_local: start.toISOString(),
    timezone: '(GMT+01:00) Europe/Amsterdam',
    utc_offset: 3600,
    distance,
    moving_time: movingTime,
    elapsed_time: movingTime + 45,
    total_elevation_gain: 42.5,
    elev_high: 12.3,
    elev_low: -1.2,
    average_speed: distance / movingTime,
    max_speed: 4.5,
    has_heartrate: hr,
    average_heartrate: hr ? 151.3 : undefined,
    max_heartrate: hr ? 178 : undefined,
    average_cadence: 84.5,
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    visibility: 'everyone',
    gear_id: 'g1',
    external_id: `ohealth_${i}.fit`,
    upload_id: 5000 + i,
    start_latlng: [52.37, 4.89],
    end_latlng: [52.37, 4.9],
    location_city: 'Amsterdam',
    map: { id: 'm', summary_polyline: 'abc', resource_state: 2 },
    athlete: { id: 1, resource_state: 1 },
    kudos_count: 3,
  };
}

function lapsOf(a) {
  return [{ id: 1, lap_index: 1, split: 1, name: 'Lap 1', distance: a.distance, elapsed_time: a.elapsed_time, moving_time: a.moving_time, start_date_local: a.start_date_local, start_index: 0, end_index: 100, average_speed: 3.14, max_speed: 4, average_heartrate: 150, max_heartrate: 170, average_cadence: 85, total_elevation_gain: 10, pace_zone: 2, resource_state: 2, activity: { id: a.id } }];
}

function detailOf(a) {
  const km = Math.floor(a.distance / 1000);
  return {
    ...a,
    description: 'easy',
    calories: 700,
    device_name: 'OnePlus Watch 3',
    gear: { id: 'g1', name: 'Shoes', distance: 123456, primary: true, resource_state: 2 },
    splits_metric: Array.from({ length: km }, (_, k) => ({
      distance: 1000, elapsed_time: 320, moving_time: 318, elevation_difference: 1.5, split: k + 1,
      average_speed: 3.14, average_grade_adjusted_speed: 3.2, average_heartrate: 150 + k, pace_zone: 2,
    })),
    splits_standard: [],
    best_efforts: [{ id: 1, name: '1k', distance: 1000, elapsed_time: 300, moving_time: 300, start_date_local: a.start_date_local, start_index: 0, end_index: 300, pr_rank: null, achievements: [] }],
    segment_efforts: [{ id: 9, name: 'secret segment', start_latlng: [52.37, 4.89] }],
    photos: { primary: null, count: 0 },
    stats_visibility: [],
    laps: lapsOf(a),
  };
}

function streamsOf(a, keys) {
  const n = Math.min(a.moving_time, 600);
  const out = {};
  const mk = (fn) => ({ data: Array.from({ length: n }, (_, t) => fn(t)), series_type: 'distance', original_size: n, resolution: 'high' });
  for (const k of keys) {
    if (k === 'time') out.time = mk((t) => t);
    else if (k === 'distance') out.distance = mk((t) => t * 3.14159);
    else if (k === 'altitude') out.altitude = mk((t) => 5 + Math.sin(t / 50) * 3.123456);
    else if (k === 'velocity_smooth') out.velocity_smooth = mk((t) => 3.1 + Math.sin(t / 30) * 0.2);
    else if (k === 'heartrate' && a.has_heartrate) out.heartrate = mk((t) => 130 + Math.min(t / 10, 40));
    else if (k === 'cadence') out.cadence = mk(() => 85);
    else if (k === 'grade_smooth') out.grade_smooth = mk((t) => Math.cos(t / 50) * 2.5);
    else if (k === 'moving') out.moving = mk((t) => t % 100 !== 0);
    else if (k === 'temp') out.temp = mk(() => 12);
    else if (k === 'latlng') out.latlng = mk((t) => [52.37 + t * 1e-5, 4.89 + t * 1e-5]);
  }
  return out;
}

/**
 * @param {object} opts
 * @param {Array} opts.activities
 * @param {number} [opts.readLimit15] read requests allowed per 15 min (default 100)
 * @param {number} [opts.readLimitDay]
 */
export async function startMockStrava({ activities, readLimit15 = 100, readLimitDay = 1000, tokenFailures = 0 } = {}) {
  const state = { requests: [], reads: 0, tokenCalls: 0, activities: [...activities], tokenFailures, forbidZones: false };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    state.requests.push(`${req.method} ${u.pathname}${u.search}`);
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...extra });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === '/oauth/token' && req.method === 'POST') {
      state.tokenCalls += 1;
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const params = new URLSearchParams(raw);
      if (state.tokenFailures > 0) {
        state.tokenFailures -= 1;
        return send(400, { message: 'Bad Request', errors: [{ resource: 'RefreshToken', code: 'invalid' }] });
      }
      if (params.get('grant_type') === 'refresh_token' && params.get('refresh_token') !== 'refresh-ok') {
        return send(400, { message: 'Bad Request', errors: [{ resource: 'RefreshToken', code: 'invalid' }] });
      }
      return send(200, {
        token_type: 'Bearer', access_token: 'access-ok', expires_at: Math.floor(Date.now() / 1000) + 21600, expires_in: 21600,
        refresh_token: 'refresh-ok', athlete: { id: 1, firstname: 'Test', lastname: 'Runner' },
      });
    }
    if (req.headers.authorization !== 'Bearer access-ok') return send(401, { message: 'Authorization Error' });
    state.reads += 1;
    const headers = {
      'x-ratelimit-limit': `${readLimit15 * 2},${readLimitDay * 2}`,
      'x-ratelimit-usage': `${state.reads},${state.reads}`,
      'x-readratelimit-limit': `${readLimit15},${readLimitDay}`,
      'x-readratelimit-usage': `${state.reads},${state.reads}`,
    };
    if (state.reads > readLimit15) return send(429, { message: 'Rate Limit Exceeded' }, headers);

    let m;
    if (u.pathname === '/api/v3/athlete/activities') {
      const page = Number(u.searchParams.get('page') || 1);
      const per = Number(u.searchParams.get('per_page') || 30);
      const after = Number(u.searchParams.get('after') || 0);
      const list = state.activities
        .filter((a) => new Date(a.start_date).getTime() / 1000 > after)
        .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
      return send(200, list.slice((page - 1) * per, page * per), headers);
    }
    if ((m = u.pathname.match(/^\/api\/v3\/activities\/(\d+)$/))) {
      const a = state.activities.find((x) => x.id === Number(m[1]));
      return a ? send(200, detailOf(a), headers) : send(404, { message: 'Record Not Found' }, headers);
    }
    if ((m = u.pathname.match(/^\/api\/v3\/activities\/(\d+)\/laps$/))) {
      const a = state.activities.find((x) => x.id === Number(m[1]));
      if (!a) return send(404, { message: 'Record Not Found' }, headers);
      return send(200, lapsOf(a), headers);
    }
    if ((m = u.pathname.match(/^\/api\/v3\/activities\/(\d+)\/zones$/))) {
      if (state.forbidZones) return send(402, { message: 'Payment Required' }, headers);
      return send(200, [{ type: 'heartrate', sensor_based: true, points: 12, custom_zones: false, score: 30, distribution_buckets: [{ min: 0, max: 120, time: 100 }, { min: 120, max: 150, time: 2000 }, { min: 150, max: 165, time: 1000 }, { min: 165, max: 180, time: 100 }, { min: 180, max: -1, time: 0 }] }], headers);
    }
    if ((m = u.pathname.match(/^\/api\/v3\/activities\/(\d+)\/streams$/))) {
      const a = state.activities.find((x) => x.id === Number(m[1]));
      if (!a || a.manual) return send(404, { message: 'Record Not Found' }, headers);
      return send(200, streamsOf(a, (u.searchParams.get('keys') || '').split(',')), headers);
    }
    return send(404, { message: 'Record Not Found' }, headers);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    state,
    apiBase: `http://127.0.0.1:${port}/api/v3`,
    tokenUrl: `http://127.0.0.1:${port}/oauth/token`,
    close: () => new Promise((r) => server.close(r)),
  };
}

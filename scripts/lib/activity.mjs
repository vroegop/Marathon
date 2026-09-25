// Source-agnostic activity model and the derived metrics the site and the
// training-plan work rely on (km splits, best efforts, grade-adjusted pace,
// elevation gain, time in HR zones). Produces the same JSON shapes as the
// Strava API sync so both data paths are interchangeable (docs/data-format.md).

export const round = (n, d) => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(d)) : n);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Strava-style sport_type from a FIT/TCX/GPX sport label. */
export function normalizeSportType(sport, subSport) {
  const s = String(sport || '').toLowerCase().replace(/[\s_-]/g, '');
  const sub = String(subSport || '').toLowerCase();
  if (s === 'running' || s === 'run') {
    if (sub.includes('trail')) return { sport_type: 'TrailRun', trainer: false };
    if (sub.includes('treadmill') || sub.includes('indoor')) return { sport_type: 'Run', trainer: true };
    if (sub.includes('virtual')) return { sport_type: 'VirtualRun', trainer: true };
    return { sport_type: 'Run', trainer: false };
  }
  if (s === 'trailrun' || s === 'trailrunning') return { sport_type: 'TrailRun', trainer: false };
  if (s === 'virtualrun') return { sport_type: 'VirtualRun', trainer: true };
  if (s === 'walking' || s === 'walk') return { sport_type: 'Walk', trainer: false };
  if (s === 'hiking' || s === 'hike') return { sport_type: 'Hike', trainer: false };
  if (s === 'cycling' || s === 'biking' || s === 'ride') {
    const indoor = sub.includes('indoor') || sub.includes('trainer') || sub.includes('virtual');
    return { sport_type: indoor ? 'VirtualRide' : 'Ride', trainer: indoor };
  }
  if (s === 'virtualride') return { sport_type: 'VirtualRide', trainer: true };
  if (s === 'swimming' || s === 'swim') return { sport_type: 'Swim', trainer: false };
  if (s === 'weighttraining' || s === 'strength' || s === 'strengthtraining') return { sport_type: 'WeightTraining', trainer: false };
  if (s === 'training' || s === 'fitnessequipment' || s === 'generic' || s === 'workout' || s === 'other' || s === '') return { sport_type: 'Workout', trainer: false };
  // Strava's own labels ("Trail Run", "Alpine Ski") -> camel case without spaces
  const camel = String(sport).replace(/\s+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
  return { sport_type: camel, trainer: false };
}

/** Offset (seconds) of an IANA time zone at a given instant. */
export function tzOffsetSeconds(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 1000);
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function movingAverage(arr, window) {
  const out = new Array(arr.length).fill(null);
  const half = Math.floor(window / 2);
  for (let i = 0; i < arr.length; i += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j += 1) {
      if (isNum(arr[j])) {
        sum += arr[j];
        n += 1;
      }
    }
    out[i] = n ? sum / n : null;
  }
  return out;
}

/** Minetti et al. (2002) energy cost of running vs. gradient, relative to flat. */
export function minettiFactor(gradeFraction) {
  const i = Math.max(-0.3, Math.min(0.3, gradeFraction));
  const c = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  return c / 3.6;
}

/** Elevation gain with a hysteresis threshold (metres), like most platforms. */
export function elevationGain(alt, threshold = 2) {
  let gain = 0;
  let ref = null;
  for (const a of alt) {
    if (!isNum(a)) continue;
    if (ref === null) {
      ref = a;
      continue;
    }
    if (a - ref >= threshold) {
      gain += a - ref;
      ref = a;
    } else if (a < ref) {
      ref = a;
    }
  }
  return gain;
}

/**
 * Turn raw samples into the repo's stream shape and compute what is missing.
 * @param {object} samples arrays aligned by index: t (seconds since start), d (m, cumulative), alt, hr, cad, v (m/s), temp, lat, lng
 * @param {object} opts { paused: [[tStart,tEnd],...] }
 */
export function buildStreams(samples, opts = {}) {
  const n = samples.t.length;
  const t = samples.t;
  // distance: from device, else from GPS
  let d = samples.d && samples.d.some(isNum) ? samples.d.slice() : null;
  if (!d && samples.lat && samples.lat.some(isNum)) {
    d = new Array(n).fill(0);
    let acc = 0;
    let last = null;
    for (let i = 0; i < n; i += 1) {
      if (isNum(samples.lat[i]) && isNum(samples.lng[i])) {
        if (last) acc += haversine(last[0], last[1], samples.lat[i], samples.lng[i]);
        last = [samples.lat[i], samples.lng[i]];
      }
      d[i] = acc;
    }
  }
  if (!d) d = new Array(n).fill(0);
  // fill gaps in distance (carry forward)
  for (let i = 0; i < n; i += 1) if (!isNum(d[i])) d[i] = i ? d[i - 1] : 0;

  // velocity: device speed, else from distance deltas over a ~5 s window
  let v = samples.v && samples.v.some(isNum) ? samples.v.slice() : null;
  if (!v) {
    v = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const j = Math.max(0, i - 5);
      const dt = t[i] - t[j];
      v[i] = dt > 0 ? (d[i] - d[j]) / dt : 0;
    }
  } else {
    for (let i = 0; i < n; i += 1) if (!isNum(v[i])) v[i] = i ? v[i - 1] : 0;
  }
  const velocity_smooth = movingAverage(v, 5).map((x) => round(x ?? 0, 3));

  // paused intervals -> moving flag
  const paused = opts.paused || [];
  const inPause = (ts) => paused.some(([a, b]) => ts > a && ts < b);
  const moving = new Array(n);
  for (let i = 0; i < n; i += 1) moving[i] = velocity_smooth[i] > 0.3 && !inPause(t[i]) ? 1 : 0;

  // grade from smoothed altitude over ~20 m of distance
  let grade_smooth = null;
  let altitude = null;
  if (samples.alt && samples.alt.some(isNum)) {
    const altS = movingAverage(samples.alt, 7);
    altitude = altS.map((a) => round(a, 1));
    grade_smooth = new Array(n).fill(0);
    let j = 0;
    for (let i = 0; i < n; i += 1) {
      while (j < i && d[i] - d[j] > 20) j += 1;
      const dd = d[i] - d[j];
      grade_smooth[i] = dd > 5 && isNum(altS[i]) && isNum(altS[j]) ? round(Math.max(-40, Math.min(40, ((altS[i] - altS[j]) / dd) * 100)), 1) : 0;
    }
  }

  const out = { series_type: 'time', original_size: n, resolution: 'high', time: t.map((x) => Math.round(x)), distance: d.map((x) => round(x, 1)) };
  if (altitude) out.altitude = altitude;
  out.velocity_smooth = velocity_smooth;
  if (samples.hr && samples.hr.some(isNum)) out.heartrate = samples.hr.map((x) => (isNum(x) ? Math.round(x) : null));
  if (samples.cad && samples.cad.some(isNum)) out.cadence = samples.cad.map((x) => (isNum(x) ? Math.round(x) : null));
  if (grade_smooth) out.grade_smooth = grade_smooth;
  out.moving = moving;
  if (samples.temp && samples.temp.some(isNum)) out.temp = samples.temp.map((x) => (isNum(x) ? Math.round(x) : null));
  if (samples.lat && samples.lat.some(isNum)) {
    out.lat = samples.lat.map((x) => round(x, 5));
    out.lng = samples.lng.map((x) => round(x, 5));
  }
  return out;
}

/** Interpolated elapsed time at which cumulative distance reaches `target`. */
function timeAtDistance(st, target, fromIndex = 0) {
  const { time: t, distance: d } = st;
  for (let i = Math.max(1, fromIndex); i < d.length; i += 1) {
    if (d[i] >= target) {
      const span = d[i] - d[i - 1];
      const f = span > 0 ? (target - d[i - 1]) / span : 1;
      return { time: t[i - 1] + f * (t[i] - t[i - 1]), index: i };
    }
  }
  return null;
}

function meanBetween(arr, i0, i1) {
  if (!arr) return null;
  let s = 0;
  let n = 0;
  for (let i = i0; i <= i1; i += 1) {
    if (isNum(arr[i])) {
      s += arr[i];
      n += 1;
    }
  }
  return n ? s / n : null;
}

/** Seconds spent moving between two sample indices; a gap of more than 15 s between samples counts as a stop. */
function movingSeconds(st, i0, i1) {
  let s = 0;
  for (let i = i0 + 1; i <= i1; i += 1) {
    const dt = st.time[i] - st.time[i - 1];
    if (st.moving[i] && dt <= 15) s += dt;
  }
  return s;
}

/** Per-kilometre splits in Strava's splits_metric shape. */
export function computeSplits(st, splitLength = 1000) {
  const total = st.distance[st.distance.length - 1] || 0;
  const splits = [];
  let prev = { time: st.time[0], index: 0 };
  let k = 1;
  for (;;) {
    const target = k * splitLength;
    const isLast = target > total;
    const cur = isLast ? { time: st.time[st.time.length - 1], index: st.time.length - 1 } : timeAtDistance(st, target, prev.index);
    if (!cur) break;
    const dist = isLast ? total - (k - 1) * splitLength : splitLength;
    if (isLast && dist < 50) break;
    const elapsed = cur.time - prev.time;
    const moving = Math.min(elapsed, movingSeconds(st, prev.index, cur.index) || elapsed);
    let gapDist = 0;
    for (let i = prev.index + 1; i <= cur.index; i += 1) {
      const dd = st.distance[i] - st.distance[i - 1];
      gapDist += dd * (st.grade_smooth ? minettiFactor(st.grade_smooth[i] / 100) : 1);
    }
    splits.push({
      split: k,
      distance: round(dist, 1),
      elapsed_time: Math.round(elapsed),
      moving_time: Math.round(moving),
      elevation_difference: st.altitude ? round(st.altitude[cur.index] - st.altitude[prev.index], 1) : 0,
      average_speed: round(moving > 0 ? dist / moving : 0, 3),
      average_grade_adjusted_speed: round(moving > 0 ? gapDist / moving : 0, 3),
      average_heartrate: round(meanBetween(st.heartrate, prev.index, cur.index), 1),
      pace_zone: 0,
    });
    if (isLast) break;
    prev = cur;
    k += 1;
  }
  return splits;
}

const EFFORT_DISTANCES = [
  ['400m', 400], ['1/2 mile', 804.672], ['1k', 1000], ['1 mile', 1609.344], ['2 mile', 3218.688], ['5k', 5000], ['10k', 10000],
  ['15k', 15000], ['10 mile', 16093.44], ['20k', 20000], ['Half-Marathon', 21097.5], ['30k', 30000], ['Marathon', 42195],
];

/** Fastest continuous efforts over the standard distances (two-pointer sweep). */
export function computeBestEfforts(st, startDateLocal) {
  const { time: t, distance: d } = st;
  const n = d.length;
  const total = d[n - 1] || 0;
  const out = [];
  for (const [name, target] of EFFORT_DISTANCES) {
    if (total < target) continue;
    let best = null;
    let j = 1;
    for (let i = 0; i < n; i += 1) {
      while (j < n && d[j] - d[i] < target) j += 1;
      if (j >= n) break;
      const span = d[j] - d[j - 1];
      const f = span > 0 ? (d[i] + target - d[j - 1]) / span : 1;
      const tEnd = t[j - 1] + f * (t[j] - t[j - 1]);
      const elapsed = tEnd - t[i];
      if (!best || elapsed < best.elapsed) best = { elapsed, start: i, end: j };
    }
    if (best) {
      const startLocal = startDateLocal ? new Date(new Date(startDateLocal).getTime() + t[best.start] * 1000).toISOString() : null;
      out.push({ name, distance: Math.round(target), elapsed_time: Math.round(best.elapsed), moving_time: Math.round(Math.min(best.elapsed, movingSeconds(st, best.start, best.end) || best.elapsed)), start_date_local: startLocal, start_index: best.start, end_index: best.end, pr_rank: null });
    }
  }
  return out;
}

/** Time in heart-rate zones for zone edges like [[0,120],[120,150],[150,165],[165,180],[180,-1]]. */
export function computeHrZones(st, zones) {
  if (!st.heartrate || !zones?.length) return null;
  const buckets = zones.map(([min, max]) => ({ min, max, time: 0 }));
  for (let i = 1; i < st.time.length; i += 1) {
    const hr = st.heartrate[i];
    if (!isNum(hr)) continue;
    const dt = st.time[i] - st.time[i - 1];
    const b = buckets.find((z) => hr >= z.min && (z.max === -1 || hr < z.max));
    if (b) b.time += dt;
  }
  return [{ type: 'heartrate', sensor_based: true, custom_zones: true, points: null, distribution_buckets: buckets.map((b) => ({ min: b.min, max: b.max, time: Math.round(b.time) })) }];
}

/**
 * Assemble index entry, detail and streams for one activity.
 * @param {object} a normalized activity from fit.mjs / gpx.mjs
 * @param {object} cfg { privacy, hrZones, elevationThreshold, streamTypes }
 */
export function assemble(a, cfg = {}) {
  const privacy = { keepLatLng: false, keepLocationNames: false, keepDescription: true, ...(cfg.privacy || {}) };
  const st = buildStreams(a.samples, { paused: a.paused });
  const n = st.time.length;
  const totalDistance = isNum(a.totals?.distance) ? a.totals.distance : st.distance[n - 1] || 0;
  const elapsed = isNum(a.totals?.elapsed) ? a.totals.elapsed : n ? st.time[n - 1] - st.time[0] : 0;
  const movingFromSamples = n ? movingSeconds(st, 0, n - 1) : 0;
  const movingTime = isNum(a.totals?.timer) ? a.totals.timer : movingFromSamples || elapsed;
  const hrVals = st.heartrate ? st.heartrate.filter(isNum) : [];
  const altVals = st.altitude ? st.altitude.filter(isNum) : [];
  const gain = isNum(a.totals?.ascent) ? a.totals.ascent : altVals.length ? elevationGain(st.altitude, cfg.elevationThreshold ?? 2) : 0;
  const { sport_type, trainer } = normalizeSportType(a.sport, a.subSport);
  const type = a.stravaType || (sport_type === 'TrailRun' || sport_type === 'VirtualRun' ? 'Run' : sport_type === 'VirtualRide' ? 'Ride' : sport_type);
  const utcOffset = isNum(a.utcOffset) ? a.utcOffset : 0;
  const startDate = a.start.toISOString();
  const startDateLocal = new Date(a.start.getTime() + utcOffset * 1000).toISOString();
  const avgSpeed = movingTime > 0 ? totalDistance / movingTime : 0;
  const maxSpeed = isNum(a.totals?.maxSpeed) ? a.totals.maxSpeed : st.velocity_smooth.reduce((m, x) => Math.max(m, x), 0);
  const avgHr = isNum(a.totals?.avgHr) ? a.totals.avgHr : hrVals.length ? hrVals.reduce((s, x) => s + x, 0) / hrVals.length : null;
  const maxHr = isNum(a.totals?.maxHr) ? a.totals.maxHr : hrVals.length ? Math.max(...hrVals) : null;
  const cadVals = st.cadence ? st.cadence.filter((x) => isNum(x) && x > 0) : [];
  const avgCad = isNum(a.totals?.avgCadence) ? a.totals.avgCadence : cadVals.length ? cadVals.reduce((s, x) => s + x, 0) / cadVals.length : null;
  const tempVals = st.temp ? st.temp.filter(isNum) : [];

  const index = {
    id: a.id,
    name: a.name || `${sport_type} ${startDateLocal.slice(0, 10)}`,
    type,
    sport_type: a.stravaSportType || sport_type,
    workout_type: a.workoutType ?? null,
    start_date: startDate,
    start_date_local: startDateLocal,
    timezone: a.timezone || null,
    utc_offset: utcOffset,
    distance: round(totalDistance, 1),
    moving_time: Math.round(movingTime),
    elapsed_time: Math.round(elapsed),
    total_elevation_gain: round(gain, 1),
    elev_high: altVals.length ? round(Math.max(...altVals), 1) : null,
    elev_low: altVals.length ? round(Math.min(...altVals), 1) : null,
    average_speed: round(avgSpeed, 3),
    max_speed: round(maxSpeed, 3),
    has_heartrate: hrVals.length > 0,
    average_heartrate: round(avgHr, 1),
    max_heartrate: maxHr,
    average_cadence: round(avgCad, 1),
    average_temp: tempVals.length ? Math.round(tempVals.reduce((s, x) => s + x, 0) / tempVals.length) : null,
    trainer: a.trainer ?? trainer,
    commute: a.commute ?? false,
    manual: n === 0,
    private: false,
    visibility: 'only_me',
    gear_id: null,
    external_id: a.externalId || null,
    upload_id: null,
    device_name: a.device || null,
    source: a.source,
    has_details: true,
    has_streams: n > 0,
  };
  for (const k of Object.keys(index)) if (index[k] === undefined) index[k] = null;

  const detail = {
    ...index,
    description: privacy.keepDescription ? a.description || null : null,
    calories: a.totals?.calories ?? null,
    perceived_exertion: a.perceivedExertion ?? null,
    gear: a.gear ? { id: null, name: a.gear, distance: null } : null,
    splits_metric: n ? computeSplits(st) : [],
    laps: (a.laps || []).map((l, i) => ({
      lap_index: i + 1,
      split: i + 1,
      name: l.name || `Lap ${i + 1}`,
      distance: round(l.distance, 1),
      elapsed_time: Math.round(l.elapsed),
      moving_time: Math.round(isNum(l.timer) ? l.timer : l.elapsed),
      start_date_local: l.start ? new Date(l.start.getTime() + utcOffset * 1000).toISOString() : null,
      start_index: l.startIndex ?? null,
      end_index: l.endIndex ?? null,
      average_speed: round(isNum(l.avgSpeed) ? l.avgSpeed : l.distance / (l.timer || l.elapsed || 1), 3),
      max_speed: round(l.maxSpeed, 3),
      average_heartrate: round(l.avgHr, 1),
      max_heartrate: l.maxHr ?? null,
      average_cadence: round(l.avgCadence, 1),
      total_elevation_gain: round(l.ascent, 1),
      pace_zone: 0,
      trigger: l.trigger || null,
    })),
    best_efforts: n && ['Run', 'TrailRun', 'VirtualRun'].includes(index.sport_type) ? computeBestEfforts(st, startDateLocal) : [],
    source_file: a.externalId || null,
    device: { manufacturer: a.manufacturer || null, product: a.product || null, name: a.device || null },
  };
  const zones = cfg.hrZones ? computeHrZones(st, cfg.hrZones) : null;
  if (zones) detail.zones = zones;
  if (privacy.keepLatLng && st.lat) {
    const firstIdx = st.lat.findIndex(isNum);
    const lastIdx = st.lat.length - 1 - [...st.lat].reverse().findIndex(isNum);
    if (firstIdx >= 0) {
      detail.start_latlng = [st.lat[firstIdx], st.lng[firstIdx]];
      detail.end_latlng = [st.lat[lastIdx], st.lng[lastIdx]];
    }
  }
  delete detail.has_details;
  delete detail.has_streams;

  const streams = { activity_id: a.id, ...st };
  if (!privacy.keepLatLng) {
    delete streams.lat;
    delete streams.lng;
  }
  return { index, detail, streams };
}

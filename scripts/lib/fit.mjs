// FIT file -> normalized activity, using Garmin's official FIT JavaScript SDK.
import { Decoder, Stream, Utils } from '@garmin/fitsdk';

const SEMI = 180 / 2 ** 31;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const secs = (a, b) => (a.getTime() - b.getTime()) / 1000;

function titleCase(s) {
  return String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * @param {Buffer|Uint8Array} bytes decoded (not gzipped) FIT file
 * @returns {object|null} normalized activity, or null when the file is not an activity
 */
export function parseFit(bytes) {
  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error('Not a FIT file');
  const { messages, errors } = decoder.read({ includeUnknownData: false, mergeHeartRates: true, convertDateTimesToDates: true });
  const fileId = messages.fileIdMesgs?.[0] || {};
  if (fileId.type && fileId.type !== 'activity') return null;
  const records = (messages.recordMesgs || []).filter((r) => r.timestamp instanceof Date);
  const sessions = messages.sessionMesgs || [];
  const laps = messages.lapMesgs || [];
  const events = messages.eventMesgs || [];
  const activity = messages.activityMesgs?.[0];
  const deviceInfos = messages.deviceInfoMesgs || [];
  if (!records.length && !sessions.length) return null;

  const session = sessions.find((s) => String(s.sport || '').toLowerCase().includes('run')) || sessions[0] || {};
  const start = session.startTime instanceof Date ? session.startTime : records[0]?.timestamp || fileId.timeCreated || new Date(0);

  // samples
  const t = [];
  const d = [];
  const alt = [];
  const hr = [];
  const cad = [];
  const v = [];
  const temp = [];
  const lat = [];
  const lng = [];
  for (const r of records) {
    t.push(secs(r.timestamp, start));
    d.push(isNum(r.distance) ? r.distance : null);
    alt.push(isNum(r.enhancedAltitude) ? r.enhancedAltitude : isNum(r.altitude) ? r.altitude : null);
    hr.push(isNum(r.heartRate) ? r.heartRate : null);
    cad.push(isNum(r.cadence) ? r.cadence + (isNum(r.fractionalCadence) ? r.fractionalCadence : 0) : null);
    v.push(isNum(r.enhancedSpeed) ? r.enhancedSpeed : isNum(r.speed) ? r.speed : null);
    temp.push(isNum(r.temperature) ? r.temperature : null);
    lat.push(isNum(r.positionLat) ? r.positionLat * SEMI : null);
    lng.push(isNum(r.positionLong) ? r.positionLong * SEMI : null);
  }
  // records before the session start (negative time): shift so time starts at 0
  const t0 = t.length ? Math.min(...t) : 0;
  if (t0 < 0) for (let i = 0; i < t.length; i += 1) t[i] -= t0;

  // pauses from timer events
  const paused = [];
  let stopAt = null;
  for (const e of events) {
    if (e.event !== 'timer' || !(e.timestamp instanceof Date)) continue;
    const ts = secs(e.timestamp, start) - Math.min(0, t0);
    if (e.eventType === 'stop' || e.eventType === 'stopAll' || e.eventType === 'stopDisable' || e.eventType === 'stopDisableAll') stopAt = ts;
    else if (e.eventType === 'start' && stopAt !== null) {
      if (ts - stopAt > 1) paused.push([stopAt, ts]);
      stopAt = null;
    }
  }

  const findIndex = (date) => {
    if (!(date instanceof Date) || !records.length) return null;
    const target = secs(date, start) - Math.min(0, t0);
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const lapsOut = laps.map((l) => {
    const lapStart = l.startTime instanceof Date ? l.startTime : null;
    const elapsed = isNum(l.totalElapsedTime) ? l.totalElapsedTime : null;
    const startIndex = findIndex(lapStart);
    const endIndex = lapStart && elapsed !== null ? findIndex(new Date(lapStart.getTime() + elapsed * 1000)) : null;
    return {
      start: lapStart,
      elapsed,
      timer: isNum(l.totalTimerTime) ? l.totalTimerTime : null,
      distance: isNum(l.totalDistance) ? l.totalDistance : null,
      avgSpeed: isNum(l.enhancedAvgSpeed) ? l.enhancedAvgSpeed : isNum(l.avgSpeed) ? l.avgSpeed : null,
      maxSpeed: isNum(l.enhancedMaxSpeed) ? l.enhancedMaxSpeed : isNum(l.maxSpeed) ? l.maxSpeed : null,
      avgHr: isNum(l.avgHeartRate) ? l.avgHeartRate : null,
      maxHr: isNum(l.maxHeartRate) ? l.maxHeartRate : null,
      avgCadence: isNum(l.avgCadence) ? l.avgCadence : null,
      ascent: isNum(l.totalAscent) ? l.totalAscent : null,
      trigger: l.lapTrigger || null,
      startIndex,
      endIndex,
    };
  });

  const dev = deviceInfos.find((x) => x.deviceIndex === 'creator' || x.deviceIndex === 0) || deviceInfos[0] || {};
  const manufacturer = dev.manufacturer || fileId.manufacturer || null;
  const product = dev.productName || fileId.productName || (dev.garminProduct ? String(dev.garminProduct) : null) || (isNum(dev.product) ? String(dev.product) : null) || (isNum(fileId.product) ? String(fileId.product) : null);
  const device = [manufacturer && manufacturer !== 'development' ? titleCase(manufacturer) : null, product].filter(Boolean).join(' ') || null;

  // activity.localTimestamp is the wall-clock time at the recording location; the SDK
  // returns it as a Date or as a FIT epoch number depending on the profile version.
  let utcOffset = null;
  if (activity?.timestamp instanceof Date && activity.localTimestamp !== undefined) {
    const local = activity.localTimestamp instanceof Date ? activity.localTimestamp : new Date(Utils.convertDateTimeToDate(activity.localTimestamp));
    if (local instanceof Date && !Number.isNaN(local.getTime())) utcOffset = Math.round(secs(local, activity.timestamp));
  }

  return {
    source: 'fit',
    start,
    utcOffset,
    sport: session.sport || 'generic',
    subSport: session.subSport || null,
    manufacturer,
    product,
    device,
    totals: {
      distance: isNum(session.totalDistance) ? session.totalDistance : null,
      elapsed: isNum(session.totalElapsedTime) ? session.totalElapsedTime : null,
      timer: isNum(session.totalTimerTime) ? session.totalTimerTime : null,
      ascent: isNum(session.totalAscent) ? session.totalAscent : null,
      descent: isNum(session.totalDescent) ? session.totalDescent : null,
      calories: isNum(session.totalCalories) ? session.totalCalories : null,
      avgHr: isNum(session.avgHeartRate) ? session.avgHeartRate : null,
      maxHr: isNum(session.maxHeartRate) ? session.maxHeartRate : null,
      avgSpeed: isNum(session.enhancedAvgSpeed) ? session.enhancedAvgSpeed : isNum(session.avgSpeed) ? session.avgSpeed : null,
      maxSpeed: isNum(session.enhancedMaxSpeed) ? session.enhancedMaxSpeed : isNum(session.maxSpeed) ? session.maxSpeed : null,
      avgCadence: isNum(session.avgCadence) ? session.avgCadence : null,
      avgTemp: isNum(session.avgTemperature) ? session.avgTemperature : null,
      trainingEffect: isNum(session.totalTrainingEffect) ? session.totalTrainingEffect : null,
    },
    samples: { t, d, alt, hr, cad, v, temp, lat, lng },
    laps: lapsOut,
    paused,
    decodeErrors: errors?.length ? errors.map((e) => String(e.message || e)) : [],
  };
}

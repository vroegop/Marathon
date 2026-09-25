// Builds a small fake Strava bulk export (zip with activities.csv + FIT/GPX files)
// with Garmin's FIT encoder, for the ingest tests.
import zlib from 'node:zlib';
import { Encoder, Profile, Utils } from '@garmin/fitsdk';

const semi = (deg) => Math.round(deg / (180 / 2 ** 31));

export function makeFit({ start = new Date('2026-06-14T06:30:00Z'), seconds = 2400, pauseAt = 1200, pauseLen = 60, utcOffset = 7200 } = {}) {
  const enc = new Encoder();
  const at = (s) => new Date(start.getTime() + s * 1000);
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start, serialNumber: 12345 });
  enc.onMesg(Profile.MesgNum.DEVICE_INFO, { timestamp: start, deviceIndex: 'creator', manufacturer: 'development', productName: 'OnePlus Watch 3' });
  enc.onMesg(Profile.MesgNum.EVENT, { timestamp: start, event: 'timer', eventType: 'start', eventGroup: 0 });
  let dist = 0;
  let hrSum = 0;
  let hrMax = 0;
  let n = 0;
  let nextLap = 1000;
  let lapStart = 0;
  let lapStartDist = 0;
  const laps = [];
  for (let s = 0; s <= seconds; s += 1) {
    if (s === pauseAt) enc.onMesg(Profile.MesgNum.EVENT, { timestamp: at(s), event: 'timer', eventType: 'stop', eventGroup: 0 });
    if (s > pauseAt && s < pauseAt + pauseLen) continue;
    if (s === pauseAt + pauseLen) enc.onMesg(Profile.MesgNum.EVENT, { timestamp: at(s), event: 'timer', eventType: 'start', eventGroup: 0 });
    const v = 3.1 + 0.3 * Math.sin(s / 60);
    if (s > 0 && s !== pauseAt + pauseLen) dist += v;
    const hr = Math.round(130 + Math.min(40, s / 40));
    hrSum += hr;
    hrMax = Math.max(hrMax, hr);
    n += 1;
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: at(s),
      positionLat: semi(52.37 + s * 1e-5),
      positionLong: semi(4.89 + s * 5e-6),
      distance: dist,
      enhancedSpeed: v,
      heartRate: hr,
      cadence: 85,
      enhancedAltitude: 5 + 3 * Math.sin(s / 200),
      temperature: 14,
    });
    if (dist >= nextLap || s === seconds) {
      laps.push({ startTime: at(lapStart), timestamp: at(s), totalElapsedTime: s - lapStart, totalTimerTime: s - lapStart - (lapStart < pauseAt && s > pauseAt ? pauseLen : 0), totalDistance: dist - lapStartDist, avgHeartRate: 150, maxHeartRate: 170, enhancedAvgSpeed: 3.1, enhancedMaxSpeed: 3.4, avgCadence: 85, totalAscent: 2, lapTrigger: s === seconds ? 'sessionEnd' : 'distance', event: 'lap', eventType: 'stop' });
      lapStart = s;
      lapStartDist = dist;
      nextLap += 1000;
    }
  }
  for (const l of laps) enc.onMesg(Profile.MesgNum.LAP, l);
  const session = {
    timestamp: at(seconds), startTime: start, sport: 'running', subSport: 'generic', totalElapsedTime: seconds, totalTimerTime: seconds - pauseLen, totalDistance: dist,
    totalAscent: 12, totalDescent: 11, totalCalories: 500, avgHeartRate: Math.round(hrSum / n), maxHeartRate: hrMax, enhancedAvgSpeed: dist / (seconds - pauseLen), enhancedMaxSpeed: 3.4, avgCadence: 85, event: 'session', eventType: 'stop', firstLapIndex: 0, numLaps: laps.length,
  };
  enc.onMesg(Profile.MesgNum.SESSION, session);
  enc.onMesg(Profile.MesgNum.ACTIVITY, { timestamp: at(seconds), localTimestamp: Utils.convertDateToDateTime(at(seconds)) + utcOffset, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop', totalTimerTime: seconds - pauseLen });
  return { bytes: Buffer.from(enc.close()), expected: { distance: dist, samples: n, laps: laps.length, avgHr: hrSum / n, maxHr: hrMax, elapsed: seconds, timer: seconds - pauseLen } };
}

export function makeGpx({ start = new Date('2026-06-20T17:00:00Z'), seconds = 600 } = {}) {
  let pts = '';
  for (let s = 0; s <= seconds; s += 2) {
    const lat = 52.1 + s * 2e-5;
    const lon = 5.1;
    pts += `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${(20 + s / 50).toFixed(1)}</ele><time>${new Date(start.getTime() + s * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${140 + (s % 10)}</gpxtpx:hr><gpxtpx:cad>84</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx creator="StravaGPX" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><metadata><time>${start.toISOString()}</time></metadata><trk><name>Evening Trail</name><type>running</type><trkseg>\n${pts}</trkseg></trk></gpx>`;
}

/** Minimal ZIP writer (deflate) — enough to exercise scripts/lib/zip.mjs. */
export function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const comp = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, eocd]);
}

export const CSV_HEADER = 'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Max Heart Rate,Relative Effort,Commute,Activity Private Note,Activity Gear,Filename,Athlete Weight,Bike Weight,Elapsed Time,Moving Time,Distance,Max Speed,Average Speed,Elevation Gain,Elevation Loss,Elevation Low,Elevation High,Max Grade,Average Grade,Max Cadence,Average Cadence,Max Heart Rate,Average Heart Rate,Calories,Perceived Exertion';

export function csvRow(fields) {
  const cols = CSV_HEADER.split(',');
  const row = new Array(cols.length).fill('');
  const seen = {};
  for (const [k, v] of Object.entries(fields)) {
    const [name, occ] = k.split('#');
    let idx = -1;
    let count = 0;
    cols.forEach((c, i) => {
      if (c === name) {
        count += 1;
        if (count === Number(occ || 1)) idx = i;
      }
    });
    if (idx >= 0) row[idx] = v;
    seen[k] = true;
  }
  return row.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',');
}

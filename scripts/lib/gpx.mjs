// GPX / TCX -> normalized activity. Regex-based on purpose: no XML dependency,
// tolerant of the namespace prefixes Strava, Garmin and phone apps use.
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (s) => (s === undefined || s === null || s === '' ? null : Number(s));
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<`, 'i'));
  return m ? m[1].trim() : null;
};

export function parseGpx(text) {
  const trkName = tag(text, 'name');
  const trkType = tag(text, 'type');
  const pts = [];
  const re = /<trkpt\s+([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    const body = m[2];
    const lat = num(attrs.match(/lat="([^"]+)"/)?.[1]);
    const lon = num(attrs.match(/lon="([^"]+)"/)?.[1]);
    const time = tag(body, 'time');
    if (!time) continue;
    pts.push({ time: new Date(time), lat, lng: lon, alt: num(tag(body, 'ele')), hr: num(tag(body, 'hr')), cad: num(tag(body, 'cad')), temp: num(tag(body, 'atemp')) });
  }
  if (!pts.length) return null;
  return fromPoints(pts, { source: 'gpx', name: trkName, sport: /\d+/.test(trkType || '') ? null : trkType || 'running' });
}

export function parseTcx(text) {
  const sport = text.match(/<Activity\s+Sport="([^"]+)"/i)?.[1] || 'Running';
  const pts = [];
  const laps = [];
  const lapRe = /<Lap\s+StartTime="([^"]+)"[^>]*>([\s\S]*?)<\/Lap>/gi;
  let lm;
  while ((lm = lapRe.exec(text))) {
    const body = lm[2];
    laps.push({ start: new Date(lm[1]), elapsed: num(tag(body, 'TotalTimeSeconds')), timer: num(tag(body, 'TotalTimeSeconds')), distance: num(tag(body, 'DistanceMeters')), avgHr: num(body.match(/<AverageHeartRateBpm>\s*<Value>([^<]+)<\/Value>/i)?.[1]), maxHr: num(body.match(/<MaximumHeartRateBpm>\s*<Value>([^<]+)<\/Value>/i)?.[1]), maxSpeed: num(tag(body, 'MaximumSpeed')), calories: num(tag(body, 'Calories')), trigger: body.match(/<TriggerMethod>([^<]+)</i)?.[1] || null });
    const ptRe = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi;
    let pm;
    while ((pm = ptRe.exec(body))) {
      const p = pm[1];
      const time = tag(p, 'Time');
      if (!time) continue;
      pts.push({ time: new Date(time), lat: num(tag(p, 'LatitudeDegrees')), lng: num(tag(p, 'LongitudeDegrees')), alt: num(tag(p, 'AltitudeMeters')), d: num(tag(p, 'DistanceMeters')), hr: num(p.match(/<HeartRateBpm>\s*<Value>([^<]+)<\/Value>/i)?.[1]), cad: num(tag(p, 'RunCadence') ?? tag(p, 'Cadence')), v: num(tag(p, 'Speed')) });
    }
  }
  if (!pts.length) return null;
  const a = fromPoints(pts, { source: 'tcx', sport, name: tag(text, 'Notes') ? null : null });
  a.laps = laps.map((l) => ({ ...l, avgSpeed: isNum(l.distance) && l.timer ? l.distance / l.timer : null }));
  a.totals.calories = laps.reduce((s, l) => s + (l.calories || 0), 0) || null;
  a.device = text.match(/<Creator[^>]*>\s*<Name>([^<]+)<\/Name>/i)?.[1] || null;
  return a;
}

function fromPoints(pts, meta) {
  pts.sort((a, b) => a.time - b.time);
  const start = pts[0].time;
  const samples = { t: [], d: [], alt: [], hr: [], cad: [], v: [], temp: [], lat: [], lng: [] };
  for (const p of pts) {
    samples.t.push((p.time.getTime() - start.getTime()) / 1000);
    samples.d.push(isNum(p.d) ? p.d : null);
    samples.alt.push(isNum(p.alt) ? p.alt : null);
    samples.hr.push(isNum(p.hr) ? p.hr : null);
    samples.cad.push(isNum(p.cad) ? p.cad : null);
    samples.v.push(isNum(p.v) ? p.v : null);
    samples.temp.push(isNum(p.temp) ? p.temp : null);
    samples.lat.push(isNum(p.lat) ? p.lat : null);
    samples.lng.push(isNum(p.lng) ? p.lng : null);
  }
  if (!samples.d.some(isNum)) samples.d = null;
  if (!samples.v.some(isNum)) samples.v = null;
  return { source: meta.source, start, utcOffset: null, sport: meta.sport || 'running', subSport: null, name: meta.name || null, manufacturer: null, product: null, device: null, totals: {}, samples, laps: [], paused: [] };
}

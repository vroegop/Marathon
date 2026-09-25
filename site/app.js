// Marathon training log: reads data/activities.json (+ per-run details/streams)
// produced by scripts/strava-sync.mjs and renders a small dashboard.
// No dependencies; SVG is built by hand.

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SVG = 'http://www.w3.org/2000/svg';
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- small helpers ----------
function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined) e.append(c);
  return e;
}
function s(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) e.append(c);
  return e;
}
const pad2 = (n) => String(n).padStart(2, '0');
const fmt = {
  km: (m, d = 1) => (m / 1000).toFixed(d),
  pace: (mps) => {
    if (!mps || mps <= 0) return '–';
    const sec = Math.round(1000 / mps);
    return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
  },
  paceSec: (sec) => `${Math.floor(sec / 60)}:${pad2(Math.round(sec % 60))}`,
  hms: (sec) => {
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = Math.round(sec % 60);
    return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${mm}:${pad2(ss)}`;
  },
  date: (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  dateFull: (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  time: (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  int: (n) => Math.round(n).toLocaleString(),
};
// start_date_local is wall-clock time at the run location with a misleading "Z"; parse as local.
const localDate = (a) => new Date(a.start_date_local.replace('Z', ''));
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const niceStep = (max, ticks = 4) => {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
};

async function loadJson(url, fallback) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

// ---------- tooltip ----------
function makeTooltip(container) {
  const tip = h('div', { class: 'tooltip', role: 'status' });
  tip.hidden = true;
  container.append(tip);
  return {
    show(x, y, title, rows) {
      tip.replaceChildren(
        h('div', { class: 'tt-title', text: title }),
        ...rows.map(([name, val, cls]) =>
          h('div', { class: 'tt-row' }, [
            h('span', {}, [cls ? h('span', { class: `key ${cls}`, style: `background: var(--${cls})` }) : null, h('span', { class: 'name', text: name })]),
            h('span', { class: 'val', text: val }),
          ])
        )
      );
      tip.hidden = false;
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      const left = x + 14 + tw > cw ? Math.max(0, x - tw - 14) : x + 14;
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// ---------- weekly column chart ----------
function renderWeekly(container, weeks) {
  container.replaceChildren();
  const W = Math.max(320, container.clientWidth);
  const H = 220;
  const m = { top: 20, right: 12, bottom: 28, left: 34 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(1, ...weeks.map((w) => w.km));
  const step = niceStep(max);
  const yMax = Math.ceil(max / step) * step;
  const y = (v) => m.top + ih - (v / yMax) * ih;
  const slot = iw / weeks.length;
  const bw = Math.min(24, Math.max(3, slot - 2));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Weekly running volume in kilometres' });
  const grid = s('g', { class: 'grid' });
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    grid.append(s('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
    grid.append(s('text', { x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end', text: v.toLocaleString() }));
  }
  svg.append(grid);
  const tip = makeTooltip(container);
  const bars = s('g');
  weeks.forEach((w, i) => {
    const x = m.left + i * slot + (slot - bw) / 2;
    const top = y(w.km);
    const hgt = Math.max(0, m.top + ih - top);
    const r = Math.min(4, bw / 2, hgt);
    // rounded data-end, square baseline
    const d = hgt <= 0 ? '' : `M${x},${m.top + ih} V${top + r} a${r},${r} 0 0 1 ${r},-${r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${m.top + ih} Z`;
    const bar = s('path', { d, class: 'bar' });
    const hit = s('rect', { x: m.left + i * slot, y: m.top, width: slot, height: ih, class: 'hit', tabindex: 0, 'aria-label': `Week of ${fmt.date(w.start)}: ${w.km.toFixed(1)} km in ${w.runs} runs` });
    const show = () => {
      bar.classList.add('is-hover');
      tip.show(x + bw / 2, top, `Week of ${fmt.date(w.start)}`, [
        ['Distance', `${w.km.toFixed(1)} km`, 'series-1'],
        ['Runs', String(w.runs)],
        ['Time', fmt.hms(w.time)],
        ['Longest', `${fmt.km(w.longest)} km`],
      ]);
    };
    const hide = () => {
      bar.classList.remove('is-hover');
      tip.hide();
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', show);
    hit.addEventListener('blur', hide);
    bars.append(bar, hit);
  });
  svg.append(bars);
  // x labels: first week of each month, dropping a label that would collide with the next one
  const monthLabels = weeks.map((w, i) => (i === 0 || w.start.getMonth() !== weeks[i - 1].start.getMonth() ? i : -1)).filter((i) => i >= 0);
  const minGap = Math.ceil(34 / slot);
  monthLabels.forEach((i, k) => {
    if (k + 1 < monthLabels.length && monthLabels[k + 1] - i < minGap) return;
    svg.append(s('text', { x: m.left + i * slot + slot / 2, y: H - 8, 'text-anchor': 'middle', text: weeks[i].start.toLocaleDateString(undefined, { month: 'short' }) }));
  });
  svg.append(s('line', { class: 'baseline', x1: m.left, x2: W - m.right, y1: m.top + ih, y2: m.top + ih }));
  // direct label: the current week only
  const last = weeks[weeks.length - 1];
  if (last && last.km > 0) {
    const i = weeks.length - 1;
    svg.append(s('text', { class: 'label-direct', x: m.left + i * slot + slot / 2, y: y(last.km) - 6, 'text-anchor': 'middle', text: last.km.toFixed(1) }));
  }
  container.append(svg);
}

function renderWeeklyTable(container, weeks) {
  const tbl = h('table', {}, [
    h('thead', {}, h('tr', {}, [h('th', { text: 'Week of' }), h('th', { class: 'num', text: 'km' }), h('th', { class: 'num', text: 'Runs' }), h('th', { class: 'num', text: 'Time' }), h('th', { class: 'num', text: 'Longest' })])),
    h('tbody', {}, [...weeks].reverse().map((w) => h('tr', {}, [h('td', { text: fmt.date(w.start) }), h('td', { class: 'num', text: w.km.toFixed(1) }), h('td', { class: 'num', text: String(w.runs) }), h('td', { class: 'num', text: fmt.hms(w.time) }), h('td', { class: 'num', text: fmt.km(w.longest) })]))),
  ]);
  container.replaceChildren(tbl);
}

// ---------- stream charts (pace / heart rate / elevation as small multiples) ----------
function downsample(xs, ys, maxPoints = 700) {
  if (xs.length <= maxPoints) return { xs, ys };
  const f = Math.ceil(xs.length / maxPoints);
  const ox = [];
  const oy = [];
  for (let i = 0; i < xs.length; i += f) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = i; j < Math.min(i + f, xs.length); j += 1) {
      if (ys[j] === null || ys[j] === undefined) continue;
      sx += xs[j];
      sy += ys[j];
      n += 1;
    }
    if (n) {
      ox.push(sx / n);
      oy.push(sy / n);
    }
  }
  return { xs: ox, ys: oy };
}

function renderStreams(container, st) {
  container.replaceChildren();
  if (!st || !st.distance || !st.time) {
    container.append(h('p', { class: 'muted', text: 'No per-second data for this run.' }));
    return;
  }
  const xkm = st.distance.map((d) => d / 1000);
  const panels = [];
  if (st.velocity_smooth) {
    // pace in s/km; ignore near-stops so a walk break does not squash the axis
    const pace = st.velocity_smooth.map((v) => (v > 0.8 ? 1000 / v : null));
    panels.push({ title: 'Pace', unit: 'min/km', ys: pace, cls: 's1', key: 'series-1', invert: true, fmt: (v) => fmt.paceSec(v), tick: (v) => fmt.paceSec(v), step: 30 });
  }
  if (st.heartrate) panels.push({ title: 'Heart rate', unit: 'bpm', ys: st.heartrate, cls: 's2', key: 'series-2', fmt: (v) => `${Math.round(v)} bpm`, tick: (v) => String(Math.round(v)) });
  if (st.altitude) panels.push({ title: 'Elevation', unit: 'm', ys: st.altitude, cls: 's3', key: 'series-3', area: true, fmt: (v) => `${Math.round(v)} m`, tick: (v) => String(Math.round(v)) });
  if (!panels.length) {
    container.append(h('p', { class: 'muted', text: 'No pace, heart-rate or elevation streams for this run.' }));
    return;
  }
  const W = Math.max(320, container.clientWidth);
  const PH = 110;
  const gap = 26;
  const m = { top: 8, right: 12, bottom: 22, left: 40 };
  const iw = W - m.left - m.right;
  const H = m.top + panels.length * (PH + gap) - gap + m.bottom;
  const xMax = xkm[xkm.length - 1] || 1;
  const x = (km) => m.left + (km / xMax) * iw;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Pace, heart rate and elevation over distance' });
  const tip = makeTooltip(container);
  const crosshair = s('line', { class: 'crosshair', y1: m.top, y2: H - m.bottom, x1: 0, x2: 0, visibility: 'hidden' });
  const markers = [];

  panels.forEach((p, pi) => {
    const top = m.top + pi * (PH + gap);
    const { xs, ys } = downsample(xkm, p.ys);
    const vals = ys.filter((v) => v !== null && Number.isFinite(v));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (p.invert) {
      // pace: clamp outliers to keep the useful band readable
      const sorted = [...vals].sort((a, b) => a - b);
      lo = sorted[Math.floor(sorted.length * 0.02)];
      hi = sorted[Math.floor(sorted.length * 0.98)];
    }
    if (hi - lo < 1e-9) hi = lo + 1;
    const padY = (hi - lo) * 0.08;
    lo -= padY;
    hi += padY;
    const y = (v) => (p.invert ? top + ((v - lo) / (hi - lo)) * PH : top + PH - ((v - lo) / (hi - lo)) * PH);
    p.y = y;
    p.lo = lo;
    p.hi = hi;
    // grid + ticks
    const step = p.step || niceStep(hi - lo, 3);
    const grid = s('g', { class: 'grid' });
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      grid.append(s('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
      grid.append(s('text', { x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end', text: p.tick(v) }));
    }
    svg.append(grid);
    svg.append(s('text', { class: 'panel-title', x: m.left, y: top - 6, text: `${p.title} (${p.unit})` }));
    // path
    let d = '';
    let pen = false;
    xs.forEach((kx, i) => {
      const v = ys[i];
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      const cy = Math.min(top + PH, Math.max(top, y(v)));
      d += `${pen ? 'L' : 'M'}${x(kx).toFixed(1)},${cy.toFixed(1)}`;
      pen = true;
    });
    if (p.area && d) {
      const area = `${d}L${x(xs[xs.length - 1]).toFixed(1)},${top + PH}L${x(xs[0]).toFixed(1)},${top + PH}Z`;
      svg.append(s('path', { d: area, class: `area ${p.cls}`, stroke: 'none' }));
    }
    svg.append(s('path', { d, class: `line ${p.cls}` }));
    svg.append(s('line', { class: 'baseline', x1: m.left, x2: W - m.right, y1: top + PH, y2: top + PH }));
    const mk = s('circle', { r: 4, class: `marker ${p.cls}`, visibility: 'hidden' });
    markers.push(mk);
    svg.append(mk);
  });
  // x axis (km)
  const xStep = niceStep(xMax, 6);
  for (let v = 0; v <= xMax + 1e-9; v += xStep) {
    svg.append(s('text', { x: x(v), y: H - 6, 'text-anchor': 'middle', text: `${v} km` }));
  }
  svg.append(crosshair);
  // hover layer: nearest sample by distance
  const hit = s('rect', { x: m.left, y: m.top, width: iw, height: H - m.top - m.bottom, class: 'hit' });
  const nearest = (km) => {
    let lo = 0;
    let hi = xkm.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xkm[mid] < km) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  hit.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const km = ((px - m.left) / iw) * xMax;
    const i = nearest(Math.max(0, Math.min(xMax, km)));
    const cx = x(xkm[i]);
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    crosshair.setAttribute('visibility', 'visible');
    const rows = [];
    panels.forEach((p, pi) => {
      const v = p.ys[i];
      const mk = markers[pi];
      if (v === null || !Number.isFinite(v)) {
        mk.setAttribute('visibility', 'hidden');
        rows.push([p.title, '–', p.key]);
        return;
      }
      mk.setAttribute('cx', cx);
      mk.setAttribute('cy', Math.min(m.top + pi * (PH + gap) + PH, Math.max(m.top + pi * (PH + gap), p.y(v))));
      mk.setAttribute('visibility', 'visible');
      rows.push([p.title, p.fmt(v), p.key]);
    });
    tip.show((cx / W) * rect.width, (ev.clientY - rect.top), `${xkm[i].toFixed(2)} km · ${fmt.hms(st.time[i])}`, rows);
  });
  hit.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    markers.forEach((mk) => mk.setAttribute('visibility', 'hidden'));
    tip.hide();
  });
  svg.append(hit);
  container.append(svg);
}

function renderSplits(container, detail) {
  const splits = detail?.splits_metric || [];
  if (!splits.length) {
    container.replaceChildren(h('p', { class: 'muted', text: 'No kilometre splits available.' }));
    return;
  }
  const tbl = h('table', {}, [
    h('thead', {}, h('tr', {}, [h('th', { text: 'km' }), h('th', { class: 'num', text: 'Pace' }), h('th', { class: 'num', text: 'GAP' }), h('th', { class: 'num', text: 'HR' }), h('th', { class: 'num', text: 'Elev' })])),
    h('tbody', {}, splits.map((sp) => {
      const partial = sp.distance < 950 ? ` (${fmt.km(sp.distance, 2)})` : '';
      return h('tr', {}, [
        h('td', { text: `${sp.split}${partial}` }),
        h('td', { class: 'num', text: fmt.pace(sp.average_speed) }),
        h('td', { class: 'num', text: fmt.pace(sp.average_grade_adjusted_speed) }),
        h('td', { class: 'num', text: sp.average_heartrate ? String(Math.round(sp.average_heartrate)) : '–' }),
        h('td', { class: 'num', text: `${sp.elevation_difference >= 0 ? '+' : ''}${Math.round(sp.elevation_difference)} m` }),
      ]);
    })),
  ]);
  container.replaceChildren(tbl);
}

// ---------- page ----------
async function main() {
  const activities = await loadJson('data/activities.json', []);
  const state = await loadJson('data/sync-state.json', {});
  const runs = activities.filter((a) => RUN_TYPES.has(a.sport_type || a.type)).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const sub = $('#subtitle');
  const footer = $('#footer-sync');
  if (state.last_run) {
    footer.textContent = `Last synced ${fmt.dateFull(new Date(state.last_run))} ${fmt.time(new Date(state.last_run))} · ${activities.length} activities` + (state.pending_details + state.pending_streams > 0 ? ` · ${state.pending_details + state.pending_streams} still downloading` : '');
  }
  if (!runs.length) {
    sub.textContent = 'No runs synced yet.';
    $('#empty').hidden = false;
    return;
  }
  $('#dashboard').hidden = false;
  const first = localDate(runs[runs.length - 1]);
  sub.textContent = `${runs.length} runs since ${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;

  // KPIs
  const now = new Date();
  const sum = (arr, f) => arr.reduce((t, a) => t + (f(a) || 0), 0);
  const inDays = (n) => runs.filter((a) => localDate(a) >= addDays(now, -n));
  const last7 = inDays(7);
  const last28 = inDays(28);
  const prev28 = runs.filter((a) => localDate(a) >= addDays(now, -56) && localDate(a) < addDays(now, -28));
  const last90 = inDays(90);
  const longest = last90.reduce((m, a) => (a.distance > (m?.distance || 0) ? a : m), null);
  const hr28 = last28.filter((a) => a.average_heartrate);
  const wAvgHr = hr28.length ? sum(hr28, (a) => a.average_heartrate * a.moving_time) / sum(hr28, (a) => a.moving_time) : null;
  const d28 = sum(last28, (a) => a.distance);
  const dPrev = sum(prev28, (a) => a.distance);
  const delta = dPrev ? ((d28 - dPrev) / dPrev) * 100 : null;
  const kpi = (label, value, unit, sub) => h('div', { class: 'kpi' }, [h('div', { class: 'label', text: label }), h('div', { class: 'value' }, [document.createTextNode(value), unit ? h('small', { text: unit }) : null]), sub ? h('div', { class: 'sub', text: sub }) : null]);
  $('#kpis').replaceChildren(
    kpi('Last 7 days', fmt.km(sum(last7, (a) => a.distance), 0), 'km', `${last7.length} runs · ${fmt.hms(sum(last7, (a) => a.moving_time))}`),
    kpi('Last 4 weeks', fmt.km(d28, 0), 'km', delta === null ? `${last28.length} runs` : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs previous 4 weeks`),
    kpi('Longest run, 90 days', longest ? fmt.km(longest.distance) : '–', longest ? 'km' : '', longest ? `${fmt.date(localDate(longest))} · ${fmt.pace(longest.average_speed)}/km` : ''),
    kpi('Avg pace, 4 weeks', d28 ? fmt.pace(d28 / sum(last28, (a) => a.moving_time)) : '–', d28 ? '/km' : '', wAvgHr ? `avg HR ${Math.round(wAvgHr)} bpm` : '')
  );

  // weekly chart
  const weeklyChart = $('#weekly-chart');
  const weeklyTable = $('#weekly-table');
  let weeksN = 26;
  const buildWeeks = () => {
    const thisWeek = weekStart(now);
    const out = [];
    for (let w = weeksN - 1; w >= 0; w -= 1) {
      const start = addDays(thisWeek, -7 * w);
      const end = addDays(start, 7);
      const wk = runs.filter((a) => {
        const d = localDate(a);
        return d >= start && d < end;
      });
      out.push({ start, km: sum(wk, (a) => a.distance) / 1000, runs: wk.length, time: sum(wk, (a) => a.moving_time), longest: wk.reduce((m, a) => Math.max(m, a.distance), 0) });
    }
    return out;
  };
  const drawWeekly = () => {
    const weeks = buildWeeks();
    renderWeekly(weeklyChart, weeks);
    renderWeeklyTable(weeklyTable, weeks);
  };
  drawWeekly();
  for (const chip of document.querySelectorAll('.chip[data-weeks]')) {
    chip.addEventListener('click', () => {
      weeksN = Number(chip.dataset.weeks);
      for (const c of document.querySelectorAll('.chip[data-weeks]')) {
        c.classList.toggle('is-selected', c === chip);
        c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
      }
      drawWeekly();
    });
  }
  $('#weekly-table-toggle').addEventListener('click', (ev) => {
    const open = weeklyTable.hidden;
    weeklyTable.hidden = !open;
    ev.currentTarget.setAttribute('aria-expanded', String(open));
    ev.currentTarget.textContent = open ? 'Hide table' : 'Table';
  });

  // runs table
  const tbody = $('#runs-table tbody');
  const more = $('#runs-more');
  let shown = 20;
  const drawRuns = () => {
    tbody.replaceChildren(
      ...runs.slice(0, shown).map((a) =>
        h('tr', { tabindex: 0, 'data-id': a.id, onclick: () => openDetail(a), onkeydown: (ev) => { if (ev.key === 'Enter') openDetail(a); } }, [
          h('td', { text: fmt.date(localDate(a)) }),
          h('td', { class: 'name', text: a.name || 'Run', title: a.name || '' }),
          h('td', { class: 'num', text: fmt.km(a.distance) }),
          h('td', { class: 'num', text: fmt.hms(a.moving_time) }),
          h('td', { class: 'num', text: fmt.pace(a.average_speed) }),
          h('td', { class: 'num col-hr', text: a.average_heartrate ? String(Math.round(a.average_heartrate)) : '–' }),
          h('td', { class: 'num col-elev', text: `${Math.round(a.total_elevation_gain || 0)} m` }),
        ])
      )
    );
    more.hidden = shown >= runs.length;
    $('#runs-count').textContent = `${Math.min(shown, runs.length)} of ${runs.length}`;
  };
  more.addEventListener('click', () => {
    shown = runs.length;
    drawRuns();
  });
  drawRuns();

  // detail
  const detailCard = $('#detail');
  let current = null;
  async function openDetail(a) {
    current = a;
    for (const tr of tbody.querySelectorAll('tr')) tr.classList.toggle('is-selected', Number(tr.dataset.id) === a.id);
    detailCard.hidden = false;
    $('#detail-title').textContent = a.name || 'Run';
    const d = localDate(a);
    $('#detail-meta').textContent = `${fmt.dateFull(d)} ${fmt.time(d)} · ${fmt.km(a.distance)} km · ${fmt.hms(a.moving_time)} · ${fmt.pace(a.average_speed)}/km` + (a.average_heartrate ? ` · avg HR ${Math.round(a.average_heartrate)} (max ${a.max_heartrate})` : '') + ` · +${Math.round(a.total_elevation_gain || 0)} m` + (a.device_name ? ` · ${a.device_name}` : '');
    $('#stream-charts').replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    $('#splits').replaceChildren();
    const [detail, streams] = await Promise.all([
      a.has_details ? loadJson(`data/activities/${a.id}.json`, null) : null,
      a.has_streams ? loadJson(`data/streams/${a.id}.json`, null) : null,
    ]);
    if (current !== a) return;
    renderStreams($('#stream-charts'), streams);
    renderSplits($('#splits'), detail);
    detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#detail-close').addEventListener('click', () => {
    detailCard.hidden = true;
    current = null;
    for (const tr of tbody.querySelectorAll('tr')) tr.classList.remove('is-selected');
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawWeekly();
      if (current) openDetail(current);
    }, 150);
  });
}

main().catch((err) => {
  console.error(err);
  $('#subtitle').textContent = `Could not load data: ${err.message}`;
});

/* global Chart */
import {
  loadAll, todayISO, daysBetween, parseISO, fmtDate, fmtPace, fmtKm, fmtTime, fmtDuration, cssVar, esc, showError,
} from "./common.js";

const TODAY = todayISO();
const charts = {};

// Charts read colours from CSS tokens, so a theme switch needs a redraw.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => location.reload());

loadAll().then(render).catch(showError);

function setupDefaults() {
  Chart.defaults.font.family = "Barlow, system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = cssVar("--muted");
  Chart.defaults.borderColor = cssVar("--line");
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.color = cssVar("--ink-2");
  Chart.defaults.plugins.legend.align = "start";
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar("--ink");
  Chart.defaults.plugins.tooltip.titleColor = cssVar("--page");
  Chart.defaults.plugins.tooltip.bodyColor = cssVar("--page");
  Chart.defaults.plugins.tooltip.padding = 8;
  Chart.defaults.interaction = { mode: "index", intersect: false };
}

const axis = (title, extra = {}) => ({
  grid: { color: cssVar("--line"), drawTicks: false },
  border: { display: false },
  title: title ? { display: true, text: title, color: cssVar("--muted") } : undefined,
  ...extra,
});
const xAxis = (extra = {}) => ({ grid: { display: false }, border: { color: cssVar("--line") }, ticks: { maxRotation: 0, autoSkipPadding: 12 }, ...extra });

function make(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

function render({ plan, acts, daily }) {
  setupDefaults();
  const runs = acts.activities.filter((a) => a.kind === "run");
  renderTotals(runs, plan);
  renderRecords(runs, plan);
  const drawVolume = (range) => {
    const limit = new Date(`${TODAY}T12:00:00`);
    limit.setDate(limit.getDate() + 56);
    const weeks = range === "all" ? plan.weeks : plan.weeks.filter((w) => new Date(`${w.start}T12:00:00`) <= limit);
    renderWeekly(weeks);
    renderLong(weeks);
  };
  drawVolume("near");
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    drawVolume(b.dataset.range);
  }));
  renderEfficiency(runs, plan.athlete);
  renderZones(runs, acts.hr_zones);
  renderPaceHr(runs, plan.athlete.hr_zones);
  renderPredictions(plan);
  renderDaily(daily.days);
  document.getElementById("footer").textContent =
    `Watch data up to ${fmtDate(acts.data_until, { day: "numeric", month: "long", year: "numeric" })}.`;
}

function renderTotals(runs, plan) {
  const total = runs.reduce((a, r) => a + r.km, 0);
  const lastMonth = runs.filter((r) => daysBetween(r.date, plan.data_until) < 28).reduce((a, r) => a + r.km, 0);
  const hours = runs.reduce((a, r) => a + r.minutes, 0) / 60;
  const since = runs[0]?.date;
  const weeksActive = since ? Math.max(1, daysBetween(since, plan.data_until) / 7) : 1;
  const tiles = [
    [Math.round(total), `km run since ${fmtDate(since, { day: "numeric", month: "long" })}`],
    [runs.length, "runs"],
    [(runs.length / weeksActive).toFixed(1), "runs per week on average"],
    [Math.round(lastMonth / 4), "km per week, last 4 weeks"],
    [Math.round(hours), "hours running"],
  ];
  document.getElementById("totals").innerHTML = tiles.map(([v, l]) => `<div class="stat"><b class="num">${v}</b><span>${esc(l)}</span></div>`).join("");
}

const weekLabel = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const shortDate = (iso) => fmtDate(iso, { day: "numeric", month: "short" });

// ---------------------------------------------------------------- records

const PR_DISTANCES = [["1k", "1 km", 1], ["5k", "5 km", 5], ["10k", "10 km", 10], ["15k", "15 km", 15],
  ["half", "Half marathon", 21.0975], ["30k", "30 km", 30], ["marathon", "Marathon", 42.195]];
const NEW_DAYS = 14; // a record set this recently gets a "New" badge

function renderRecords(runs, plan) {
  const races = Object.fromEntries(plan.races.map((r) => [r.date, r]));
  const sorted = [...runs].sort((a, b) => a.start.localeCompare(b.start));
  const where = (r) => {
    const race = races[r.date];
    return race ? `In the ${race.name}${race.result ? ` (finish ${race.result})` : ""}` : `In a ${fmtKm(r.km)} run`;
  };
  const isNew = (iso) => daysBetween(iso, plan.data_until) < NEW_DAYS;
  const tile = ({ label, value, lines, date }) => `<article class="panel record">
    <span class="label">${esc(label)}${isNew(date) ? '<span class="badge">New</span>' : ""}</span>
    <b class="value">${esc(value)}</b>
    ${lines.filter(Boolean).map(([text, muted]) => `<span class="line${muted ? " muted" : ""}">${esc(text)}</span>`).join("")}
  </article>`;

  // Fastest times: the record now, and the one it beat.
  const speed = [];
  for (const [key, label, km] of PR_DISTANCES) {
    const history = [];
    for (const r of sorted) {
      const sec = r.best?.[key];
      if (sec && (!history.length || sec < history.at(-1).sec)) history.push({ sec, r });
    }
    if (!history.length) continue;
    const cur = history.at(-1);
    const prev = history.at(-2);
    speed.push(tile({ label, value: fmtTime(cur.sec), date: cur.r.date, lines: [
      [`${fmtPace(cur.sec / km)} /km, ${shortDate(cur.r.date)}`],
      [where(cur.r), true],
      prev && [`Previous best ${fmtTime(prev.sec)} (${shortDate(prev.r.date)})`, true],
    ] }));
  }
  document.getElementById("records-speed").innerHTML = speed.join("") || `<p class="muted">No runs with GPS yet.</p>`;

  const max = (list, f) => list.reduce((a, x) => (f(x) > f(a) ? x : a), list[0]);
  const size = [];
  if (runs.length) {
    const long = max(runs, (r) => r.km);
    size.push(tile({ label: "Longest run", value: fmtKm(long.km), date: long.date,
      lines: [[`${fmtDuration(long.minutes)}, ${shortDate(long.date)}`]] }));
    const time = max(runs, (r) => r.minutes);
    size.push(tile({ label: "Longest time running", value: fmtDuration(time.minutes), date: time.date,
      lines: [[`${fmtKm(time.km)}, ${shortDate(time.date)}`]] }));
  }
  const done = plan.weeks.filter((w) => w.km_done > 0);
  if (done.length) {
    const week = max(done, (w) => w.km_done);
    size.push(tile({ label: "Biggest week", value: `${Math.round(week.km_done)} km`, date: week.start,
      lines: [[`Week of ${shortDate(week.start)}, ${week.runs_done} runs`]] }));
  }
  const climbs = runs.filter((r) => r.elev_m);
  if (climbs.length) {
    const climb = max(climbs, (r) => r.elev_m);
    size.push(tile({ label: "Most climbing", value: `${climb.elev_m} m`, date: climb.date,
      lines: [[`${fmtKm(climb.km)}, ${shortDate(climb.date)}`]] }));
  }
  document.getElementById("records-size").innerHTML = size.join("");
}

function renderWeekly(weeks) {
  const futureIdx = weeks.findIndex((w) => daysBetween(w.start, TODAY) < 0);
  make("c-weekly", {
    type: "bar",
    data: {
      labels: weeks.map((w) => weekLabel(w.start)),
      datasets: [
        { label: "Planned", data: weeks.map((w) => w.km_plan || null), backgroundColor: cssVar("--terrain-plan"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.8 },
        { label: "Run", data: weeks.map((w, i) => (futureIdx !== -1 && i >= futureIdx ? null : w.km_done)), backgroundColor: cssVar("--accent"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.8 },
      ],
    },
    options: {
      scales: { x: xAxis(), y: axis("km") },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y} km` } } },
    },
  });
}

function renderLong(weeks) {
  const futureIdx = weeks.findIndex((w) => daysBetween(w.start, TODAY) < 0);
  make("c-long", {
    type: "line",
    data: {
      labels: weeks.map((w) => weekLabel(w.start)),
      datasets: [
        { label: "Planned", data: weeks.map((w) => w.long_plan || null), borderColor: cssVar("--terrain-plan"), backgroundColor: cssVar("--terrain-plan"), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, spanGaps: true, stepped: "middle" },
        { label: "Run", data: weeks.map((w, i) => (futureIdx !== -1 && i >= futureIdx ? null : w.long_done || null)), borderColor: cssVar("--c-long"), backgroundColor: cssVar("--c-long"), borderWidth: 2, pointRadius: 4, pointBorderColor: cssVar("--surface"), pointBorderWidth: 2, spanGaps: true },
      ],
    },
    options: { scales: { x: xAxis(), y: axis("km", { beginAtZero: true }) } },
  });
}

// Each steady run's pace converted to one reference heart rate, assuming speed grows in
// proportion to heart rate above resting (heart-rate reserve). Rising line = fitter.
function renderEfficiency(runs, athlete) {
  const z = athlete.hr_zones;
  const ref = Math.round((z[1][0] + z[1][1]) / 2 / 5) * 5; // middle of zone 2, rounded
  const rest = athlete.hr_rest;
  const pts = runs.filter((r) => r.pace_ok && r.hr_avg && r.minutes >= 15 && r.hr_avg <= z[2][1] && r.hr_avg > rest + 20);
  const atRef = pts.map((r) => Math.round(r.pace * (r.hr_avg - rest) / (ref - rest)));
  const avg = atRef.map((_, i) => {
    const win = atRef.slice(Math.max(0, i - 4), i + 1);
    return Math.round(win.reduce((a, b) => a + b, 0) / win.length);
  });
  document.getElementById("eff-caption").textContent =
    `Every steady run converted to the pace it equals at ${ref} bpm, the middle of your easy zone. When the line rises, you run faster for the same effort: the clearest sign the engine is growing. Races and hard sessions are left out.`;
  make("c-eff", {
    type: "line",
    data: {
      labels: pts.map((r) => shortDate(r.date)),
      datasets: [
        { label: "Each run", data: atRef, showLine: false, pointRadius: 4, pointHoverRadius: 6, borderColor: cssVar("--surface"), borderWidth: 2, backgroundColor: cssVar("--c-easy") },
        { label: "Average of the last 5", data: avg, borderColor: cssVar("--ink"), backgroundColor: cssVar("--ink"), borderWidth: 2, pointRadius: 0, tension: 0.3 },
      ],
    },
    options: {
      scales: { x: xAxis(), y: axis(`pace at ${ref} bpm  (faster ↑)`, { reverse: true, ticks: { callback: (v) => fmtPace(v) } }) },
      plugins: { tooltip: { callbacks: {
        label: (c) => `${c.dataset.label}: ${fmtPace(c.parsed.y)} /km at ${ref} bpm`,
        afterBody: (items) => {
          const r = pts[items[0].dataIndex];
          return `Actual: ${fmtKm(r.km)} at ${fmtPace(r.pace)} /km, ${r.hr_avg} bpm`;
        },
      } } },
    },
  });
}

function renderZones(runs, zones) {
  const byWeek = new Map();
  for (const r of runs) {
    if (!r.hr_avg) continue;
    const d = new Date(`${r.date}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    const acc = byWeek.get(key) || [0, 0, 0, 0, 0];
    r.zone_min.forEach((m, i) => { acc[i] += m; });
    byWeek.set(key, acc);
  }
  const keys = [...byWeek.keys()].sort();
  // Zones are ordered, so they use one sequential hue (light = easy, dark = hard).
  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  const ramp = dark ? ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"] : ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
  make("c-zones", {
    type: "bar",
    data: {
      labels: keys.map((k) => weekLabel(k)),
      datasets: zones.map((z, i) => ({
        label: `Z${i + 1} (${z[0]}–${z[1]})`, data: keys.map((k) => Math.round(byWeek.get(k)[i])),
        backgroundColor: ramp[i], borderColor: cssVar("--surface"), borderWidth: { top: 2 }, borderSkipped: false,
      })),
    },
    options: {
      scales: { x: xAxis({ stacked: true }), y: axis("minutes", { stacked: true }) },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y} min` } } },
    },
  });
}

// Shades the heart-rate zones behind a chart whose x axis is heart rate.
const zoneBands = (zones) => ({
  id: "zoneBands",
  // Extra space under the legend for the zone labels.
  beforeInit(chart) {
    const fit = chart.legend.fit;
    chart.legend.fit = function () {
      fit.call(this);
      this.height += 18;
    };
  },
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    ctx.save();
    zones.forEach(([lo, hi], i) => {
      const left = Math.max(x.getPixelForValue(lo), a.left);
      const right = Math.min(x.getPixelForValue(hi), a.right);
      if (right <= left) return;
      if (i % 2 === 0) {
        ctx.fillStyle = cssVar("--surface-2");
        ctx.fillRect(left, a.top, right - left, a.bottom - a.top);
      }
      if (right - left > 22) {
        ctx.fillStyle = cssVar("--muted");
        ctx.font = "600 12px Barlow, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`Z${i + 1}`, (left + right) / 2, a.top - 5);
      }
    });
    ctx.restore();
  },
});

function renderPaceHr(runs, zones) {
  const pts = runs.filter((r) => r.pace_ok && r.hr_avg && r.minutes >= 15);
  const cutoff = pts.length ? pts.at(-1).date : TODAY;
  const age = (r) => daysBetween(r.date, cutoff);
  // Recency is ordered, so one hue from light (older) to strong (newest).
  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  const ramp = dark ? ["#256abf", "#6da7ec", "#cfe2fa"] : ["#7aaeed", "#2a78d6", "#0f3a73"];
  const groups = [
    ["3+ months ago", (r) => age(r) > 91, ramp[0]],
    ["1 to 3 months ago", (r) => age(r) > 28 && age(r) <= 91, ramp[1]],
    ["Last 4 weeks", (r) => age(r) <= 28, ramp[2]],
  ];
  const hrs = pts.map((r) => r.hr_avg);
  const paces = pts.map((r) => r.pace);
  make("c-pacehr", {
    type: "scatter",
    data: { datasets: groups.map(([label, test, color]) => ({
      label, data: pts.filter(test).map((r) => ({ x: r.hr_avg, y: r.pace, r })),
      backgroundColor: color, borderColor: cssVar("--surface"), borderWidth: 2, pointRadius: 5, pointHoverRadius: 7, pointHitRadius: 10,
    })).filter((d) => d.data.length) },
    options: {
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: axis("average heart rate (bpm)  (harder →)", { min: Math.floor((Math.min(...hrs) - 4) / 5) * 5, max: Math.ceil((Math.max(...hrs) + 4) / 5) * 5, grid: { display: false } }),
        y: axis("pace (min/km)  (faster ↑)", { reverse: true, min: Math.floor((Math.min(...paces) - 10) / 20) * 20,
          max: Math.ceil((Math.max(...paces) + 10) / 20) * 20, ticks: { callback: (v) => fmtPace(v) } }),
      },
      plugins: { tooltip: { callbacks: { label: (c) => {
        const r = c.raw.r;
        return `${shortDate(r.date)}: ${fmtKm(r.km)} at ${fmtPace(r.pace)} /km, ${r.hr_avg} bpm`;
      } } } },
    },
    plugins: [zoneBands(zones)],
  });
}

function renderPredictions(plan) {
  const rows = plan.fitness.slice().reverse();
  const names = Object.keys(rows[0].predictions);
  document.getElementById("predictions").innerHTML = `<thead><tr><th>From</th><th>VDOT</th>${names.map((n) => `<th>${n}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((f) => `<tr><td>${fmtDate(f.date, { day: "numeric", month: "short" })} ’${f.date.slice(2, 4)}</td><td>${f.vdot}</td>${names.map((n) => `<td>${f.predictions[n]}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function renderDaily(days) {
  const recent = days.filter((d) => daysBetween(d.date, TODAY) <= 120);
  const labels = recent.map((d) => fmtDate(d.date, { day: "numeric", month: "short" }));
  const rolling = (key, n) => recent.map((_, i) => {
    const win = recent.slice(Math.max(0, i - n + 1), i + 1).map((d) => d[key]).filter((v) => v != null);
    return win.length ? Math.round(win.reduce((a, b) => a + b, 0) / win.length * 10) / 10 : null;
  });

  make("c-rhr", {
    type: "line",
    data: { labels, datasets: [
      { label: "Each day", data: recent.map((d) => d.rhr ?? null), showLine: false, pointRadius: 3, borderColor: cssVar("--c-cross"), backgroundColor: cssVar("--c-cross") },
      { label: "7-day average", data: rolling("rhr", 7), borderColor: cssVar("--ink"), borderWidth: 2, pointRadius: 0, spanGaps: true, tension: 0.3 },
    ] },
    options: { scales: { x: xAxis(), y: axis("bpm") } },
  });

  const sleep = recent.filter((d) => d.sleep_h);
  make("c-sleep", {
    type: "bar",
    data: { labels: sleep.map((d) => fmtDate(d.date, { day: "numeric", month: "short" })), datasets: [
      { label: "Hours", data: sleep.map((d) => d.sleep_h), backgroundColor: cssVar("--c-race"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 },
    ] },
    options: { plugins: { legend: { display: false } }, scales: { x: xAxis(), y: axis("hours", { beginAtZero: true }) } },
  });

  make("c-steps", {
    type: "line",
    data: { labels, datasets: [
      { label: "Steps (7-day average)", data: rolling("steps", 7), borderColor: cssVar("--c-easy"), backgroundColor: cssVar("--c-easy"), borderWidth: 2, pointRadius: 0, tension: 0.3 },
    ] },
    options: { plugins: { legend: { display: false } }, scales: { x: xAxis(), y: axis("steps") } },
  });

  // A real time axis: weigh-ins can be months apart.
  const weights = days.filter((d) => d.weight);
  const first = weights[0]?.date;
  const dayOf = (n) => { const d = parseISO(first); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  make("c-weight", {
    type: "line",
    data: { datasets: [
      { label: "kg", data: weights.map((d) => ({ x: daysBetween(first, d.date), y: d.weight })), borderColor: cssVar("--c-strength"), backgroundColor: cssVar("--c-strength"), borderWidth: 2, pointRadius: 5, pointBorderColor: cssVar("--surface"), pointBorderWidth: 2 },
    ] },
    options: {
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: (items) => fmtDate(dayOf(items[0].parsed.x), { day: "numeric", month: "short", year: "numeric" }),
        label: (c) => `${c.parsed.y} kg`,
      } } },
      scales: {
        x: xAxis({ type: "linear", ticks: { maxTicksLimit: 6, callback: (v) => { const d = parseISO(dayOf(v)); return `${d.toLocaleDateString("en-GB", { month: "short" })} ’${String(d.getFullYear()).slice(2)}`; } } }),
        y: axis("kg"),
      },
    },
  });
}

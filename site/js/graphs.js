/* global Chart */
import { loadAll, todayISO, daysBetween, fmtDate, fmtPace, fmtKm, cssVar, esc, showError } from "./common.js";

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
  renderEfficiency(runs);
  renderZones(runs, acts.hr_zones);
  renderPaceHr(runs);
  renderPredictions(plan);
  renderDaily(daily.days);
  document.getElementById("footer").textContent =
    `Watch data up to ${fmtDate(acts.data_until, { day: "numeric", month: "long", year: "numeric" })}.`;
}

function renderTotals(runs, plan) {
  const total = runs.reduce((a, r) => a + r.km, 0);
  const longest = runs.reduce((a, r) => (r.km > a.km ? r : a), runs[0]);
  const paced = runs.filter((r) => r.pace_ok && r.km >= 5);
  const fastest = paced.reduce((a, r) => (r.pace < a.pace ? r : a), paced[0]);
  const since = runs[0]?.date;
  const weeksActive = since ? Math.max(1, daysBetween(since, plan.data_until) / 7) : 1;
  const tiles = [
    [Math.round(total), `km run since ${fmtDate(since, { day: "numeric", month: "long" })}`],
    [runs.length, "runs"],
    [(runs.length / weeksActive).toFixed(1), "runs per week on average"],
    [fmtKm(longest.km), `longest run (${fmtDate(longest.date, { day: "numeric", month: "short" })})`],
    [`${fmtPace(fastest.pace)} /km`, `fastest 5 km+ run (${fmtDate(fastest.date, { day: "numeric", month: "short" })})`],
  ];
  document.getElementById("totals").innerHTML = tiles.map(([v, l]) => `<div class="stat"><b class="num">${v}</b><span>${esc(l)}</span></div>`).join("");
}

const weekLabel = (iso) => fmtDate(iso, { day: "numeric", month: "short" });

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

function renderEfficiency(runs) {
  const pts = runs.filter((r) => r.pace_ok && r.hr_avg && r.minutes >= 15);
  const eff = pts.map((r) => +((1000 / r.pace) * 60 / r.hr_avg).toFixed(3));
  const avg = eff.map((_, i) => {
    const win = eff.slice(Math.max(0, i - 4), i + 1);
    return +(win.reduce((a, b) => a + b, 0) / win.length).toFixed(3);
  });
  make("c-eff", {
    type: "line",
    data: {
      labels: pts.map((r) => fmtDate(r.date, { day: "numeric", month: "short" })),
      datasets: [
        { label: "Each run", data: eff, showLine: false, pointRadius: 4, borderColor: cssVar("--c-easy"), backgroundColor: cssVar("--c-easy") },
        { label: "Average of last 5 runs", data: avg, borderColor: cssVar("--ink"), backgroundColor: cssVar("--ink"), borderWidth: 2, pointRadius: 0, tension: 0.3 },
      ],
    },
    options: {
      scales: { x: xAxis(), y: axis("metres per heartbeat") },
      plugins: { tooltip: { callbacks: {
        afterBody: (items) => {
          const r = pts[items[0].dataIndex];
          return `${fmtKm(r.km)} at ${fmtPace(r.pace)} /km, ${r.hr_avg} bpm`;
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

function renderPaceHr(runs) {
  const pts = runs.filter((r) => r.pace_ok && r.hr_avg && r.minutes >= 15);
  const cutoff = pts.length ? pts.at(-1).date : TODAY;
  const recent = (r) => daysBetween(r.date, cutoff) <= 28;
  const set = (label, list, color) => ({
    label, data: list.map((r) => ({ x: r.hr_avg, y: r.pace, r })), backgroundColor: color, borderColor: cssVar("--surface"), borderWidth: 2, pointRadius: 5,
  });
  make("c-pacehr", {
    type: "scatter",
    data: { datasets: [set("Earlier runs", pts.filter((r) => !recent(r)), cssVar("--terrain-plan")), set("Last 4 weeks", pts.filter(recent), cssVar("--c-quality"))] },
    options: {
      interaction: { mode: "nearest", intersect: true },
      scales: {
        x: axis("average heart rate (bpm)"),
        y: axis("pace (min/km)", { reverse: true, ticks: { callback: (v) => fmtPace(v) } }),
      },
      plugins: { tooltip: { callbacks: { label: (c) => {
        const r = c.raw.r;
        return `${fmtDate(r.date, { day: "numeric", month: "short" })}: ${fmtKm(r.km)} at ${fmtPace(r.pace)} /km, ${r.hr_avg} bpm`;
      } } } },
    },
  });
}

function renderPredictions(plan) {
  const rows = plan.fitness.slice().reverse();
  const names = Object.keys(rows[0].predictions);
  document.getElementById("predictions").innerHTML = `<thead><tr><th>From</th><th>VDOT</th>${names.map((n) => `<th>${n}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((f) => `<tr><td>${fmtDate(f.date, { day: "numeric", month: "short", year: "numeric" })}</td><td>${f.vdot}</td>${names.map((n) => `<td>${f.predictions[n]}</td>`).join("")}</tr>`).join("")}</tbody>`;
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

  const weights = days.filter((d) => d.weight);
  make("c-weight", {
    type: "line",
    data: { labels: weights.map((d) => fmtDate(d.date, { day: "numeric", month: "short", year: "2-digit" })), datasets: [
      { label: "kg", data: weights.map((d) => d.weight), borderColor: cssVar("--c-strength"), backgroundColor: cssVar("--c-strength"), borderWidth: 2, pointRadius: 5 },
    ] },
    options: { plugins: { legend: { display: false } }, scales: { x: xAxis(), y: axis("kg") } },
  });
}

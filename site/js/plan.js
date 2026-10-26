import { loadJSON, todayISO, daysBetween, fmtDate, fmtPaceRange, CATEGORY_LABEL, esc, showError } from "./common.js";

const TODAY = todayISO();
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CATEGORY_ABOUT = {
  long: "The weekly long run, usually on Monday. Builds endurance; always at easy effort unless stated.",
  quality: "One (later two) harder sessions a week: tempo, intervals, hills, race pace. This is where speed comes from.",
  easy: "Easy and recovery runs. Should feel relaxed enough to chat. Most of your running is this.",
  strength: "Strength circuits and, for Iron Viking, obstacle-race circuits.",
  cross: "Volleyball and other sports. Counted as training load.",
  race: "Race day.",
  rest: "No running.",
};

loadJSON("plan").then(render).catch(showError);

function render(plan) {
  renderRaces(plan);
  renderHowTo(plan);
  renderPhases(plan);
  renderLibrary(plan);
  document.getElementById("footer").textContent = `Plan built ${fmtDate(plan.built, { day: "numeric", month: "long", year: "numeric" })}.`;
}

function renderRaces(plan) {
  document.getElementById("races").innerHTML = plan.races.map((r) => {
    const n = daysBetween(TODAY, r.date);
    const when = n > 0 ? `in ${n} days` : n === 0 ? "today" : "done";
    return `<article class="panel race">
      <div class="date">${fmtDate(r.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}, ${when}</div>
      <h3>${esc(r.name)}</h3>
      <p><b>${r.km} km.</b> <span class="goal">${esc(r.goal)}</span></p>
      <p class="muted">${esc(r.notes)}</p>
    </article>`;
  }).join("");
}

function renderHowTo(plan) {
  document.getElementById("categories").innerHTML = Object.entries(CATEGORY_LABEL).map(([k, label]) =>
    `<p><span class="chip cat-${k}"><b>${label}</b></span><br><span class="muted">${CATEGORY_ABOUT[k]}</span></p>`).join("");
  const { paces, hr_zones: z, vdot } = plan.athlete;
  document.getElementById("vdot").textContent = vdot;
  const rows = [["1", "Recovery", paces.R, z[0]], ["2", "Easy", paces.E, z[1]], ["3", "Steady", paces.M, z[2]], ["4", "Threshold", paces.T, z[3]], ["5", "Interval", paces.I, z[4]]];
  document.getElementById("zones").innerHTML = `<thead><tr><th>Zone</th><th>Pace</th><th>Heart rate</th></tr></thead><tbody>${rows.map(([n, name, p, h]) =>
    `<tr><td>${n} ${name}</td><td>${fmtPaceRange(p)}</td><td>${h[0]}–${h[1]} bpm</td></tr>`).join("")}</tbody>`;
}

function renderPhases(plan) {
  const daysByWeek = new Map();
  for (const d of plan.days) {
    const dt = new Date(`${d.date}T12:00:00`);
    const idx = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - idx);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    if (!daysByWeek.has(key)) daysByWeek.set(key, []);
    daysByWeek.get(key).push({ ...d, wd: idx });
  }
  const html = plan.phases.map((p) => {
    const weeks = plan.weeks.filter((w) => w.phase === p.id);
    const race = plan.races.find((r) => r.id === p.race);
    return `<article class="phase panel">
      <div class="phase-head"><h3>${esc(p.name)}</h3>
        <span class="muted">${fmtDate(p.start, { day: "numeric", month: "short" })} to ${fmtDate(p.end, { day: "numeric", month: "short", year: "numeric" })}${race ? `, towards ${esc(race.name)}` : ""}</span></div>
      <p><b>${esc(p.focus)}</b></p>
      <div class="phase-about">${p.about.split("\n").map((l) => `<p>${esc(l)}</p>`).join("")}</div>
      <div class="table-scroll"><table class="week-table">
        <thead><tr><th>Week</th><th>Sessions</th><th>km</th></tr></thead>
        <tbody>${weeks.map((w) => weekRow(w, daysByWeek.get(w.start) || [])).join("")}</tbody>
      </table></div>
    </article>`;
  }).join("");
  document.getElementById("phases").innerHTML = html;
}

function weekRow(w, days) {
  const current = daysBetween(w.start, TODAY) >= 0 && daysBetween(w.start, TODAY) < 7;
  const chips = days.flatMap((d) => d.sessions.filter((s) => s.category !== "rest").map((s) =>
    `<span class="chip cat-${s.category}">${WEEKDAY[d.wd]} ${esc(s.title)}</span>`)).join(" ");
  return `<tr class="${current ? "is-current" : ""}">
    <td>${fmtDate(w.start, { day: "numeric", month: "short" })}${current ? " <b>(now)</b>" : ""}${w.label ? `<br><span class="muted">${esc(w.label)}</span>` : ""}</td>
    <td>${chips}</td>
    <td class="num">${Math.round(w.km_plan)}</td>
  </tr>`;
}

function renderLibrary(plan) {
  const seen = new Set();
  const rows = Object.values(plan.sessions_library).map((s) => ({ ...s, name: s.title.replace(/\s*\{.*$/, "").trim() }))
    .filter((s) => s.name && !seen.has(s.name) && seen.add(s.name));
  document.getElementById("library").innerHTML = `<thead><tr><th>Session</th><th>What it's for</th></tr></thead><tbody>${rows.map((s) =>
    `<tr><td><span class="chip cat-${s.category}">${esc(s.name)}</span></td><td>${esc(s.why)}</td></tr>`).join("")}</tbody>`;
}

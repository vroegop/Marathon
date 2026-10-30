// Shared helpers for all pages. Data comes from site/data/*.json, produced by tools/.

export async function loadJSON(name) {
  const res = await fetch(`data/${name}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load data/${name}.json (${res.status})`);
  return res.json();
}

export const loadAll = () => Promise.all(["plan", "activities", "daily"].map(loadJSON))
  .then(([plan, acts, daily]) => ({ plan, acts, daily }));

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const parseISO = (iso) => new Date(`${iso}T12:00:00`);
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

export function fmtDate(iso, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return parseISO(iso).toLocaleDateString("en-GB", opts);
}

export function fmtPace(s) {
  if (s == null) return "–";
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

export function fmtPaceRange(range) {
  if (!range) return null;
  const [a, b] = range;
  return a === b ? `${fmtPace(a)} /km` : `${fmtPace(a)}–${fmtPace(b)} /km`;
}

export const fmtKm = (km) => (km == null ? "–" : `${Number(km).toFixed(km >= 10 ? 1 : 2).replace(/\.?0+$/, "")} km`);

export function fmtDuration(min) {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export const CATEGORY_LABEL = {
  long: "Long run", quality: "Quality", easy: "Easy", strength: "Strength & OCR",
  cross: "Volleyball & other sport", race: "Race", rest: "Rest & mobility",
};

export const FOCUS_LABEL = {
  legs: "Legs", calves: "Calves & feet", pelvis: "Pelvis control", core: "Core",
  spring: "Spring", upper: "Upper body", mobility: "Mobility",
};

// The exercises of a strength circuit or mobility routine. Names link to the Strength page.
export function circuitHTML(c) {
  if (!c) return "";
  return `<ol class="circuit">${c.items.map((it) => `<li>
    <a href="strength.html#ex-${esc(it.x)}">${esc(it.name)}</a>
    <span class="dose">${esc(it.reps)}${it.kg ? ` · ${it.kg} kg` : ""}</span>
    ${it.swapped ? `<small class="swapped"><b>Swapped:</b> ${esc(it.swapped)}</small>` : ""}
    ${it.tip ? `<small>${esc(it.tip)}</small>` : ""}
  </li>`).join("")}</ol>`;
}

export const STATUS = {
  done: { icon: "✓", label: "Done" },
  partial: { icon: "~", label: "Partly done" },
  missed: { icon: "✕", label: "Missed" },
  extra: { icon: "+", label: "Unplanned run" },
  too_hard: { icon: "!", label: "Too hard for an easy day" },
};

export function statusHTML(key) {
  const s = STATUS[key];
  return s ? `<span class="status ${key}"><i aria-hidden="true">${s.icon}</i>${s.label}</span>` : "";
}

// The main session decides the colour: the first one that isn't volleyball.
export function mainSession(day) {
  return day.sessions.find((s) => !s.cross) || day.sessions[0] || null;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function showError(err) {
  const main = document.querySelector("main");
  main.insertAdjacentHTML("afterbegin", `<p class="panel">The data didn't load: ${esc(err.message)}</p>`);
  console.error(err);
}

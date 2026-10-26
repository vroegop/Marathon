import {
  loadAll, todayISO, parseISO, daysBetween, fmtDate, fmtPace, fmtPaceRange, fmtKm, fmtDuration,
  statusHTML, mainSession, esc, showError,
} from "./common.js";

const TODAY = todayISO();

loadAll().then(render).catch(showError);

function render({ plan, acts }) {
  const runs = Object.fromEntries(acts.activities.map((a) => [a.id, a]));
  renderCountdown(plan);
  renderProfile(plan);
  renderToday(plan, runs);
  renderTimeline(plan, runs);
  renderPaces(plan);
  document.getElementById("footer").textContent =
    `Watch data up to ${fmtDate(plan.data_until, { day: "numeric", month: "long", year: "numeric" })}. Plan built ${fmtDate(plan.built, { day: "numeric", month: "long" })}.`;
}

// ---------------------------------------------------------------- hero

function renderCountdown(plan) {
  const upcoming = plan.races.filter((r) => r.date >= TODAY);
  const next = upcoming[0];
  const h1 = document.getElementById("countdown");
  const sub = document.getElementById("countdown-sub");
  if (!next) {
    h1.textContent = "Season complete";
    return;
  }
  const n = daysBetween(TODAY, next.date);
  h1.textContent = n === 0 ? `Race day: ${next.name}` : `${n} ${n === 1 ? "day" : "days"} to the ${next.name}`;
  const rest = upcoming.slice(1).map((r) => `${r.name} on ${fmtDate(r.date, { day: "numeric", month: "long" })}`);
  const goal = `Goal: ${next.goal.charAt(0).toLowerCase()}${next.goal.slice(1)}.`;
  sub.textContent = rest.length ? `${goal} After that: ${listJoin(rest)}.` : goal;
}

function listJoin(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function renderProfile(plan) {
  const weeks = plan.weeks;
  const n = weeks.length;
  const W = 1000, H = 200;
  const thisWeek = weeks.findIndex((w) => daysBetween(w.start, TODAY) < 7 && daysBetween(w.start, TODAY) >= 0);
  const value = (w, i) => (i < thisWeek ? w.km_done : i === thisWeek ? Math.max(w.km_plan, w.km_done) : w.km_plan);
  const vals = weeks.map(value);
  const max = Math.max(...vals, 10) * 1.3; // headroom for the race labels
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - (v / max) * H;
  const pts = vals.map((v, i) => [x(i), y(v)]);
  const area = (from, to) => {
    const seg = pts.slice(from, to + 1);
    if (seg.length < 2) return "";
    return `M${seg[0][0]},${H} ` + seg.map(([a, b]) => `L${a},${b}`).join(" ") + ` L${seg.at(-1)[0]},${H} Z`;
  };
  const split = Math.max(thisWeek, 0);

  const raceIdx = plan.races.map((r) => ({ r, i: weeks.findIndex((w) => daysBetween(w.start, r.date) >= 0 && daysBetween(w.start, r.date) < 7) }));
  const poles = raceIdx.map(({ i }) =>
    `<line x1="${x(i)}" x2="${x(i)}" y1="34" y2="${y(vals[i])}" stroke="var(--c-race)" stroke-width="2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`).join("");

  const el = document.getElementById("profile");
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area(split, n - 1)}" fill="var(--terrain-plan)"/>
      <path d="${area(0, split)}" fill="var(--terrain)"/>
      ${poles}
    </svg>` +
    raceIdx.map(({ r, i }) => {
      const pct = (i / (n - 1)) * 100;
      const edge = pct > 88 ? "edge-r" : pct < 8 ? "edge-l" : "";
      return `<div class="flag ${edge}" style="left:${pct}%;top:0">${esc(shortName(r.name))}<small>${fmtDate(r.date, { day: "numeric", month: "short" })}</small></div>`;
    }).join("");

  const frac = (daysBetween(weeks[0].start, TODAY) / 7) / (n - 1);
  if (frac >= 0 && frac <= 1) {
    el.insertAdjacentHTML("beforeend", `<div class="here" style="left:${frac * 100}%"><span>Today</span></div>`);
  }

  // Month ticks every quarter
  const axis = document.getElementById("profile-axis");
  axis.style.position = "relative";
  axis.style.height = "1.2em";
  const start = parseISO(weeks[0].start);
  const end = parseISO(weeks[n - 1].start);
  const ticks = [];
  for (let d = new Date(start.getFullYear(), start.getMonth() + 1, 1); d <= end; d.setMonth(d.getMonth() + 1)) {
    if (d.getMonth() % 3 === 1) ticks.push(new Date(d));
  }
  axis.innerHTML = ticks.map((d) => {
    const pct = ((d - start) / (end - start)) * 100;
    const label = `${d.toLocaleDateString("en-GB", { month: "short" })} ’${String(d.getFullYear()).slice(2)}`;
    const shift = pct < 6 ? "0" : pct > 94 ? "-100%" : "-50%";
    return `<span style="position:absolute;left:${pct}%;transform:translateX(${shift})">${label}</span>`;
  }).join("");
}

const shortName = (name) => name.replace(" Marathon", "").replace(" Trail", "");

// ---------------------------------------------------------------- today

function renderToday(plan, runs) {
  const days = plan.days;
  const idx = days.findIndex((d) => d.date === TODAY);
  const today = days[idx];
  const el = document.getElementById("today");
  const main = today && mainSession(today);

  let html = "";
  if (main && main.category !== "rest") {
    html += sessionPanel(today, main, "Today", runs);
  } else {
    const next = days.slice(idx + 1).find((d) => d.sessions.some((s) => !s.cross && s.category !== "rest"));
    html += `<div class="panel today-main cat-rest">
      <div class="today-when">Today, ${fmtDate(TODAY, { weekday: "long", day: "numeric", month: "long" })}</div>
      <h2 class="today-title">Rest day</h2>
      ${today?.sessions.filter((s) => s.cross).map((s) => `<p class="also">Also today: ${esc(s.title)}</p>`).join("") ?? ""}
      ${next ? `<p class="why">Next up, ${fmtDate(next.date, { weekday: "long", day: "numeric", month: "long" })}: <b>${esc(mainSession(next).title)}</b>. ${esc(mainSession(next).how)}</p>` : ""}
    </div>`;
  }
  html += weekPanel(plan);
  el.innerHTML = html;
}

function sessionPanel(day, s, when, runs) {
  const others = day.sessions.filter((x) => x !== s);
  return `<div class="panel today-main cat-${s.category}">
    <div class="today-when">${when}, ${fmtDate(day.date, { weekday: "long", day: "numeric", month: "long" })}</div>
    <h2 class="today-title">${esc(s.title)}</h2>
    ${targets(s)}
    <p>${esc(s.how)}</p>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
    ${s.adjusted ? `<p class="note">Changed: ${esc(s.adjusted)}</p>` : ""}
    ${others.map((o) => `<p class="also">Also today: ${esc(o.title)}</p>`).join("")}
    ${day.actual.length ? `<p class="also">${statusHTML(day.status)} ${day.actual.map((id) => runSummary(runs[id])).join(", ")}</p>` : ""}
    <p class="why">${esc(s.why)}</p>
  </div>`;
}

function targets(s) {
  const items = [];
  if (s.km) items.push([fmtKm(s.km), "distance"]);
  if (s.pace) items.push([fmtPaceRange(s.pace), s.zone ? `pace (zone ${s.zone})` : "goal pace"]);
  if (s.hr) items.push([`${s.hr[0]}–${s.hr[1]}`, `heart rate (zone ${s.hr_zone})`]);
  if (!items.length) return "";
  return `<div class="targets">${items.map(([v, l]) => `<div class="target"><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
}

function weekPanel(plan) {
  const week = plan.weeks.find((w) => daysBetween(w.start, TODAY) >= 0 && daysBetween(w.start, TODAY) < 7);
  if (!week) return "";
  const phase = plan.phases.find((p) => p.id === week.phase);
  const pct = week.km_plan ? Math.min(100, (week.km_done / week.km_plan) * 100) : 0;
  return `<div class="panel">
    <h3>This week${week.label ? `: ${esc(week.label)}` : ""}</h3>
    <p class="muted">${phase ? `${esc(phase.name)}. ${esc(phase.focus)}` : ""}</p>
    <div class="week-stats">
      <div class="stat"><b class="num">${round1(week.km_done)}</b><span>of ${round1(week.km_plan)} km run</span></div>
      <div class="stat"><b class="num">${week.runs_done}</b><span>of ${week.runs_plan} runs</span></div>
      <div class="meter" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Share of this week's km done"><i style="width:${pct}%"></i></div>
      <div class="stat"><b class="num">${round1(week.long_plan)}</b><span>km longest run planned</span></div>
      <div class="stat"><b class="num">${round1(week.long_done)}</b><span>km longest run done</span></div>
    </div>
  </div>`;
}

const round1 = (v) => Math.round(v * 10) / 10;

function runSummary(r) {
  if (!r) return "";
  const parts = [fmtKm(r.km)];
  if (r.pace_ok) parts.push(`${fmtPace(r.pace)} /km`);
  if (r.hr_avg) parts.push(`${r.hr_avg} bpm`);
  return parts.join(", ");
}

// ---------------------------------------------------------------- timeline

function renderTimeline(plan, runs) {
  const el = document.getElementById("timeline");
  const phases = Object.fromEntries(plan.phases.map((p) => [p.id, p]));
  const weeks = new Map(plan.weeks.map((w) => [w.start, w]));
  const byWeek = new Map();
  for (const d of plan.days) {
    const dt = parseISO(d.date);
    const monday = new Date(dt);
    monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(d);
  }

  let html = "";
  for (const [start, days] of byWeek) {
    const w = weeks.get(start);
    const phase = w && phases[w.phase];
    const kmText = w && w.km_plan ? `${round1(w.km_done)} / ${round1(w.km_plan)} km` : w && w.km_done ? `${round1(w.km_done)} km` : "";
    html += `<section class="week" data-week="${start}">
      <div class="week-head"><span>${fmtDate(start, { day: "numeric", month: "short" })}</span>
        <span>${phase ? esc(phase.name) : "Before the plan"}</span>
        ${w?.label ? `<span class="label">${esc(w.label)}</span>` : ""}
        <span class="km num">${kmText}</span></div>
      <div class="days">${days.map((d) => dayCard(d, runs)).join("")}</div>
    </section>`;
  }
  el.innerHTML = html;
  el.style.position = "relative";

  el.addEventListener("click", (e) => {
    const card = e.target.closest(".day");
    if (card) openDay(plan, runs, card.dataset.date);
  });

  const scrollToToday = (smooth) => {
    const t = el.querySelector(".is-today") || el.querySelector(".week:last-child");
    const weekEl = t.closest(".week");
    // Leave a sliver of last week visible so it's obvious history is to the left.
    el.scrollTo({ left: weekEl.offsetLeft - parseInt(getComputedStyle(el).paddingLeft, 10) - 48, behavior: smooth ? "smooth" : "instant" });
  };
  scrollToToday(false);
  document.getElementById("tl-today").addEventListener("click", () => scrollToToday(true));
  const step = (dir) => {
    const weeksEls = [...el.querySelectorAll(".week")];
    const pad = parseInt(getComputedStyle(el).paddingLeft, 10);
    const cur = weeksEls.findIndex((w) => w.offsetLeft - pad >= el.scrollLeft - 5);
    const target = weeksEls[Math.min(Math.max(cur + dir, 0), weeksEls.length - 1)];
    el.scrollTo({ left: target.offsetLeft - pad, behavior: "smooth" });
  };
  document.getElementById("tl-prev").addEventListener("click", () => step(-1));
  document.getElementById("tl-next").addEventListener("click", () => step(1));
}

function dayCard(d, runs) {
  const main = mainSession(d);
  const past = d.date < TODAY;
  const isToday = d.date === TODAY;
  const hasActual = d.actual.length > 0;
  const cls = ["day", past ? "is-past" : "", isToday ? "is-today" : "", hasActual ? "has-actual" : ""];
  const dateLabel = isToday ? `Today, ${fmtDate(d.date, { day: "numeric", month: "short" })}` : fmtDate(d.date);

  if (!main && !hasActual) {
    cls.push("slim", d.phase ? "cat-rest" : "cat-none");
    return `<button class="${cls.join(" ")}" data-date="${d.date}" aria-label="${fmtDate(d.date)}: ${d.phase ? "rest" : "no run"}">
      <span class="day-date">${fmtDate(d.date, { weekday: "short" })}</span>
      <span class="day-title">${d.phase ? "Rest" : ""}</span></button>`;
  }
  const cat = main ? main.category : "easy";
  cls.push(`cat-${cat}`);
  if (cat === "cross" && !hasActual && d.sessions.every((s) => s.category === "cross")) cls.push("mid");
  const title = main ? main.title : `Run ${fmtKm(d.km_done)}`;
  const extras = d.sessions.filter((s) => s !== main).map((s) => `+ ${esc(s.title)}`).join("<br>");
  const target = main && main.pace ? fmtPaceRange(main.pace) : "";
  const status = d.phase ? (d.flag === "too_hard" && d.status === "done" ? "too_hard" : d.status) : null;
  const actual = hasActual
    ? `<span class="day-actual">${status ? statusHTML(status) + "<br>" : ""}${d.actual.map((id) => runSummary(runs[id])).join("<br>")}</span>`
    : status === "missed" ? `<span class="day-actual">${statusHTML("missed")}</span>` : "";
  return `<button class="${cls.join(" ")}" data-date="${d.date}">
    <span class="day-date">${dateLabel}</span>
    <span class="day-title">${esc(title)}</span>
    ${target ? `<span class="day-target">${target}</span>` : ""}
    ${extras ? `<span class="day-extra">${extras}</span>` : ""}
    ${actual}
  </button>`;
}

// ---------------------------------------------------------------- day details

function openDay(plan, runs, iso) {
  const d = plan.days.find((x) => x.date === iso);
  const dlg = document.getElementById("day-dialog");
  const zones = plan.athlete.hr_zones;
  const body = document.getElementById("dlg-body");
  const sessions = d.sessions.map((s) => `
    <div class="dlg-session cat-${s.category}">
      <h3>${esc(s.title)}</h3>
      ${targets(s)}
      <p>${esc(s.how)}</p>
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
      ${s.adjusted ? `<p class="note">Changed: ${esc(s.adjusted)}</p>` : ""}
      <p class="why">${esc(s.why)}</p>
    </div>`).join("");
  const actual = d.actual.map((id) => {
    const r = runs[id];
    const total = r.zone_min.reduce((a, b) => a + b, 0) || 1;
    const zoneColors = ["var(--c-rest)", "var(--c-easy)", "var(--c-long)", "var(--c-quality)", "var(--s-bad)"];
    return `<div class="dlg-session cat-none">
      <h3>What the watch recorded</h3>
      <div class="run-row">
        <div><b>${fmtKm(r.km)}</b>distance</div>
        <div><b>${fmtDuration(r.minutes)}</b>time</div>
        ${r.pace_ok ? `<div><b>${fmtPace(r.pace)}</b>per km</div>` : ""}
        ${r.hr_avg ? `<div><b>${r.hr_avg}</b>avg bpm</div><div><b>${r.hr_max}</b>max bpm</div>` : ""}
        ${r.elev_m ? `<div><b>${r.elev_m} m</b>climbed</div>` : ""}
      </div>
      ${r.hr_avg ? `<div class="zonebar" aria-hidden="true">${r.zone_min.map((m, i) => `<i style="width:${(m / total) * 100}%;background:${zoneColors[i]}"></i>`).join("")}</div>
      <p class="muted">${r.zone_min.map((m, i) => `Z${i + 1} ${Math.round(m)} min`).join(", ")}. Zones: ${zones.map((z, i) => `Z${i + 1} ${z[0]}–${z[1]}`).join(", ")}.</p>` : ""}
    </div>`;
  }).join("");
  const status = d.phase && d.status && d.status !== "upcoming" ? `<p>${statusHTML(d.status)}${d.flag === "too_hard" ? " " + statusHTML("too_hard") : ""}${d.moved_from ? ` <span class="muted">(run on ${fmtDate(d.moved_from)})</span>` : ""}</p>` : "";
  body.innerHTML = `<button class="btn dlg-close" id="dlg-close">Close</button>
    <h2 id="dlg-title">${fmtDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
    ${status}
    ${sessions || (d.phase ? "<p>Rest day.</p>" : "<p class=\"muted\">Before the plan started.</p>")}
    ${actual}`;
  dlg.showModal();
  document.getElementById("dlg-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }, { once: true });
}

// ---------------------------------------------------------------- paces

function renderPaces(plan) {
  const { paces, hr_zones: z, vdot } = plan.athlete;
  document.getElementById("vdot").textContent = `Based on fitness score (VDOT) ${vdot}`;
  const rows = [
    ["Recovery", paces.R, z[0], "Recovery runs, shake-outs"],
    ["Easy", paces.E, z[1], "Easy and long runs: most of your running"],
    ["Marathon", paces.M, z[2], "Steady runs"],
    ["Threshold", paces.T, z[3], "Tempo runs, hills"],
    ["Interval", paces.I, z[4], "Intervals"],
  ];
  document.getElementById("paces").innerHTML = `<thead><tr><th>Zone</th><th>Pace</th><th>Heart rate</th><th>Used for</th></tr></thead>
    <tbody>${rows.map(([n, p, h, u]) => `<tr><td>${n}</td><td>${fmtPaceRange(p)}</td><td>${h[0]}–${h[1]} bpm</td><td>${u}</td></tr>`).join("")}</tbody>`;
}

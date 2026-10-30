import { loadJSON, todayISO, fmtDate, circuitHTML, FOCUS_LABEL, esc, showError } from "./common.js";

const TODAY = todayISO();

loadJSON("plan").then(render).catch(showError);

function render(plan) {
  const st = plan.strength;
  renderSwaps(st);
  renderNext(plan);
  renderBlocks(st);
  renderRoutines(st);
  renderChanged(st);
  renderLibrary(st);
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
  document.getElementById("footer").textContent =
    `${Object.keys(st.exercises).length} exercises. Plan built ${fmtDate(plan.built, { day: "numeric", month: "long", year: "numeric" })}.`;
}

// Temporary swaps (adjustments.toml) that apply now or soon.
function renderSwaps(st) {
  const active = st.swaps.filter((s) => s.to >= TODAY);
  if (!active.length) return;
  const name = (x) => st.exercises[x]?.name || x;
  document.getElementById("swaps").innerHTML = `<section class="block"><div class="panel today-main cat-strength">
    <h3>Swapped for now</h3>
    ${active.map((s) => `<p>${fmtDate(s.from)} to ${fmtDate(s.to)}: ${[s.replace].flat().map(name).map(esc).join(", ")}
      ${s.with ? `→ <b>${esc(name(s.with))}</b>` : "left out"}. ${esc(s.note || "")}</p>`).join("")}
  </div></section>`;
}

function renderNext(plan) {
  const upcoming = plan.days.filter((d) => d.date >= TODAY)
    .flatMap((d) => d.sessions.filter((s) => s.key === "strength").map((s) => ({ d, s })))
    .slice(0, 4);
  const now = upcoming[0]?.s.circuit;
  document.getElementById("block-now").textContent = now?.block_name ? `Now: the ${now.block_name} block` : "";
  document.getElementById("next").innerHTML = upcoming.length ? upcoming.map(({ d, s }) => {
    const with_ = d.sessions.filter((x) => x !== s && !x.cross && x.category !== "rest").map((x) => x.title);
    const when = d.date === TODAY ? "Today" : fmtDate(d.date, { weekday: "long", day: "numeric", month: "short" });
    return `<article class="panel next-card">
      <div class="eyebrow">${when}</div>
      <h3>${esc(s.title)}</h3>
      <p class="muted">${s.circuit.rounds} rounds${with_.length ? `, after: ${esc(with_.join(" + "))}` : ""}${s.circuit.block_name ? `. ${esc(s.circuit.block_name)} block` : ""}.</p>
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
    </article>`;
  }).join("") : `<p class="muted">No circuits planned from here on.</p>`;
}

// Tabs per block; the block covering today (or the next one) is shown first.
function renderBlocks(st) {
  const tabs = document.getElementById("block-tabs");
  const current = st.blocks.find((b) => b.to >= TODAY) || st.blocks.at(-1);
  const short = (iso) => fmtDate(iso, { month: "short" });
  tabs.innerHTML = st.blocks.map((b) =>
    `<button class="btn" data-block="${esc(b.id)}" aria-pressed="${b === current}">${esc(b.name)} <span class="muted">${short(b.from)}–${short(b.to)}</span></button>`).join("");
  const show = (id) => {
    const b = st.blocks.find((x) => x.id === id);
    tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.block === id));
    document.getElementById("block-focus").innerHTML =
      `<b>${esc(b.name)}, ${fmtDate(b.from, { day: "numeric", month: "long" })} to ${fmtDate(b.to, { day: "numeric", month: "long", year: "numeric" })}.</b> ${esc(b.focus)}`;
    document.getElementById("block-about").textContent = b.about;
    const circuits = [...st.circuits.filter((c) => c.block === id), ...st.circuits.filter((c) => !c.block)];
    document.getElementById("circuits").innerHTML = circuits.map((c) => `
      <article class="panel circuit-card">
        <div class="eyebrow">Circuit ${esc(c.id)}${c.block ? "" : ": race weeks and holidays"}</div>
        <h3>${esc(c.name)}</h3>
        <p class="muted">${c.rounds} rounds, about ${Math.round((c.rounds * st.min_per_round) / 5) * 5} minutes.</p>
        ${circuitHTML(c)}
      </article>`).join("");
  };
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) show(b.dataset.block);
  });
  show(current.id);
}

function renderRoutines(st) {
  document.getElementById("routines").innerHTML = [st.warmup, st.mobility].map((r) => `
    <article class="panel circuit-card routine">
      <h3>${esc(r.name)}</h3>
      <p class="muted">${esc(r.about)}</p>
      ${circuitHTML(r)}
    </article>`).join("");
}

function renderChanged(st) {
  document.getElementById("changed").innerHTML = st.changed.map((c) => `<article class="panel change">
    <div class="muted">You did: ${esc(c.old)}</div>
    <h3>Now: <a href="#ex-${esc(c.new)}">${esc(c.name)}</a></h3>
    <p>${esc(c.why)}</p>
  </article>`).join("");
}

function renderLibrary(st) {
  // Where each exercise is used, e.g. "Foundation A, Build A".
  const blockName = Object.fromEntries(st.blocks.map((b) => [b.id, b.name]));
  const usedIn = {};
  for (const c of st.circuits) {
    for (const it of c.items) (usedIn[it.x] ||= []).push(c.block ? `${blockName[c.block]} ${c.id}` : `Circuit ${c.id}`);
  }
  for (const r of [st.warmup, st.mobility]) {
    for (const it of r.items) (usedIn[it.x] ||= []).push(r.name.replace(/\s*\(.*\)$/, ""));
  }

  const el = document.getElementById("exercises");
  el.innerHTML = Object.entries(st.exercises).map(([key, x]) => `
    <details class="ex" id="ex-${esc(key)}" data-focus="${esc(x.focus.join(" "))}">
      <summary><b>${esc(x.name)}</b>
        <span class="tags">${x.focus.map((f) => `<span class="tag ${esc(f)}">${esc(FOCUS_LABEL[f] || f)}</span>`).join("")}</span></summary>
      <div class="ex-body">
        <p class="kit">Kit: ${esc(x.kit)}${usedIn[key] ? `. In: ${esc([...new Set(usedIn[key])].join(", "))}` : ""}.</p>
        <p>${esc(x.how)}</p>
        <ul>${x.cues.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <p class="why">${esc(x.why)}</p>
      </div>
    </details>`).join("");

  const filter = document.getElementById("focus-filter");
  filter.innerHTML = [["all", "All"], ...Object.entries(FOCUS_LABEL)].map(([k, label]) =>
    `<button class="btn" data-focus="${k}" aria-pressed="${k === "all"}">${label}</button>`).join("");
  filter.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) applyFilter(b.dataset.focus);
  });
}

function applyFilter(focus) {
  document.querySelectorAll("#focus-filter button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.focus === focus));
  document.querySelectorAll(".ex").forEach((ex) => {
    ex.hidden = focus !== "all" && !ex.dataset.focus.split(" ").includes(focus);
  });
}

// Links like strength.html#ex-hip-airplane open that exercise.
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id.startsWith("ex-")) return;
  const ex = document.getElementById(id);
  if (!ex) return;
  applyFilter("all");
  ex.open = true;
  ex.scrollIntoView({ block: "start" });
}

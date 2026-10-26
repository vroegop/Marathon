import { loadJSON, fmtDate, esc, showError } from "./common.js";

const KIND = { coach: "Coach's note", result: "Race result", sick: "Sick", injury: "Injury", life: "Life" };

loadJSON("plan").then(render).catch(showError);

function render(plan) {
  const entries = [
    ...plan.journal,
    ...plan.disruptions.map((d) => ({ date: d.from, kind: d.kind, title: `${KIND[d.kind] || d.kind}: ${d.note || ""}`,
      body: `From ${fmtDate(d.from)} to ${fmtDate(d.to)}. Sessions in this period became rest${d.return_days ? `; the ${d.return_days} days after are easy running at reduced volume` : ""}.` })),
    ...plan.fitness.slice(1).map((f) => ({ date: f.date, kind: "result", title: `Fitness updated to VDOT ${f.vdot}`, body: f.source })),
  ].map((e, i) => ({ ...e, i }))
    // Newest first; on the same date, the entry written last comes first.
    .sort((a, b) => b.date.localeCompare(a.date) || b.i - a.i);

  document.getElementById("entries").innerHTML = entries.map((e) => `
    <article class="entry kind-${esc(e.kind)}">
      <div class="when">${fmtDate(e.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${KIND[e.kind] || esc(e.kind)}</div>
      <h3>${esc(e.title)}</h3>
      ${String(e.body || "").split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, " ")}</p>`).join("")}
    </article>`).join("");
  document.getElementById("footer").textContent = `${entries.length} entries.`;
}

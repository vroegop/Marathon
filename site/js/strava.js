// Post strength, elliptical and mobility sessions to Strava as manual activities.
//
// Uses Randy's own Strava API app. Its client id and secret, and the tokens Strava hands
// out, are kept in this browser's localStorage only: the site and the repository are
// public, so nothing about the connection is ever written to them.
import { esc, todayISO } from "./common.js";

const API = "https://www.strava.com";
const CONFIG = "strava";         // { clientId, clientSecret, accessToken, refreshToken, expiresAt, athlete }
const POSTED = "strava.posted";  // { "2026-11-03|strength": activityId }
const PENDING = "strava.pending"; // sessionStorage, across the Strava login: { state, date, key }
const SPORT = { strength: "WeightTraining", elliptical: "Elliptical", mobility: "Workout" };
const SPORT_LABEL = { WeightTraining: "Strength training", Elliptical: "Elliptical", Workout: "Workout", Yoga: "Yoga" };
const PRIMER_MIN = 4; // the mobility primer before every circuit

let plan;
let dialog;

function load(key, store = localStorage) {
  try { return JSON.parse(store.getItem(key)) || {}; } catch { return {}; }
}

function save(key, value, store = localStorage) {
  try { store.setItem(key, JSON.stringify(value)); } catch { /* private mode: lasts for this page only */ }
}

const connected = () => Boolean(load(CONFIG).refreshToken);

// The button for one session, or a link to the activity once it's posted.
export function postButton(date, s) {
  if (!(s.key in SPORT) || date > todayISO()) return "";
  const id = load(POSTED)[`${date}|${s.key}`];
  return `<div class="strava-row">${id
    ? `<a class="btn strava-done" href="${API}/activities/${encodeURIComponent(id)}" target="_blank" rel="noopener">On Strava ✓</a>`
    : `<button class="btn strava-btn" data-strava="${esc(date)}|${esc(s.key)}">Post to Strava</button>`}</div>`;
}

export function initStrava(planData) {
  plan = planData;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-strava]");
    if (!b) return;
    const [date, key] = b.dataset.strava.split("|");
    openPost(date, key);
  });
  handleCallback();
}

// ---------------------------------------------------------------- Strava API

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth/token`, { method: "POST", body: new URLSearchParams(params) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `Strava answered ${res.status}`);
  const t = { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at };
  if (j.athlete) t.athlete = [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(" ");
  return t;
}

async function accessToken() {
  const cfg = load(CONFIG);
  if (cfg.expiresAt > Date.now() / 1000 + 60) return cfg.accessToken;
  const t = await tokenRequest({
    client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token", refresh_token: cfg.refreshToken,
  });
  save(CONFIG, { ...cfg, ...t });
  return t.accessToken;
}

// Back from the Strava login page with ?code=... (or ?error=...).
async function handleCallback() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return;
  history.replaceState(null, "", location.pathname + location.hash);
  const pending = load(PENDING, sessionStorage);
  try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  if (!pending.state || q.get("state") !== pending.state) return message("Connecting to Strava didn't work: the answer didn't match this page. Please try again.");
  if (q.has("error")) return message("Connecting to Strava was cancelled.");
  if (!(q.get("scope") || "").includes("activity:write")) {
    return message("Strava needs permission to upload activities. Connect again and leave that box ticked.");
  }
  try {
    const cfg = load(CONFIG);
    const t = await tokenRequest({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: q.get("code"), grant_type: "authorization_code" });
    save(CONFIG, { ...cfg, ...t });
  } catch (err) {
    return message(`Connecting to Strava didn't work: ${err.message}. Check the Client ID and Secret and try again.`);
  }
  if (pending.date) openPost(pending.date, pending.key);
  else message("Strava is connected.");
}

// ---------------------------------------------------------------- dialog

function show(html) {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "sv-title");
    dialog.innerHTML = '<div class="dlg-body" id="sv-body"></div>';
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog || e.target.closest("[data-sv-close]")) dialog.close();
    });
    document.body.append(dialog);
  }
  dialog.querySelector("#sv-body").innerHTML = html;
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function message(text) {
  show(`<h2 id="sv-title">Strava</h2><p>${esc(text)}</p>
    <div class="dlg-actions"><button class="btn" data-sv-close>Close</button></div>`);
}

function openPost(date, key) {
  const day = plan.days.find((d) => d.date === date);
  const s = day?.sessions.find((x) => x.key === key);
  if (!s) return;
  if (connected()) postView(day, s);
  else setupView(date, key);
}

function setupView(date, key) {
  const cfg = load(CONFIG);
  const site = location.origin + location.pathname.replace(/[^/]*$/, "");
  const d = show(`<h2 id="sv-title">Connect Strava</h2>
    <p>Once per phone or browser:</p>
    <ol class="steps">
      <li>Open <a href="${API}/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> and create an app. Any name and category; Website <code>${esc(site)}</code>; Authorization Callback Domain <code>${esc(location.hostname)}</code>.</li>
      <li>Copy the app's Client ID and Client Secret into the fields below.</li>
      <li>Tap Connect and approve on Strava. You come straight back here to post.</li>
    </ol>
    <div class="form">
      <label>Client ID <input id="sv-id" inputmode="numeric" autocomplete="off" value="${esc(cfg.clientId || "")}"></label>
      <label>Client Secret <input id="sv-secret" type="password" autocomplete="off" value="${esc(cfg.clientSecret || "")}"></label>
      <p class="muted">Stored only in this browser, never on the site or GitHub.</p>
      <p class="sv-msg" id="sv-msg" role="status"></p>
      <div class="dlg-actions"><button class="btn" data-sv-close>Cancel</button><button class="btn btn-primary" id="sv-connect">Connect</button></div>
    </div>`);
  d.querySelector("#sv-connect").addEventListener("click", () => {
    const clientId = d.querySelector("#sv-id").value.trim();
    const clientSecret = d.querySelector("#sv-secret").value.trim();
    if (!/^\d+$/.test(clientId) || !clientSecret) {
      d.querySelector("#sv-msg").textContent = "Fill in both: the Client ID is a number, the Secret a long code.";
      return;
    }
    const state = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    save(CONFIG, { clientId, clientSecret });
    save(PENDING, { state, date, key }, sessionStorage);
    location.href = `${API}/oauth/authorize?${new URLSearchParams({
      client_id: clientId, response_type: "code", redirect_uri: location.origin + location.pathname,
      approval_prompt: "auto", scope: "activity:write", state,
    })}`;
  });
}

function defaults(day, s) {
  let mins = 15;
  if (s.key === "elliptical") mins = s.minutes;
  if (s.key === "strength") mins = Math.round((s.circuit.rounds * plan.strength.min_per_round) / 5) * 5 + PRIMER_MIN;
  const pad = (n) => String(n).padStart(2, "0");
  let start = `${day.date}T18:00`;
  if (day.date === todayISO()) {
    const t = new Date(Date.now() - mins * 60000);
    if (t.toDateString() === new Date().toDateString()) start = `${day.date}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }
  const lines = [];
  if (s.circuit) {
    if (s.key === "strength") lines.push(`${s.circuit.rounds} rounds:`);
    s.circuit.items.forEach((it, i) => lines.push(`${i + 1}. ${it.name}: ${it.reps}${it.kg ? ` · ${it.kg} kg` : ""}`));
  } else {
    lines.push("Easy effort, heart-rate zone 2.");
  }
  lines.push("", `Plan: ${new URL(s.circuit ? "strength.html" : "./", location.href).href}`);
  return { name: s.title, sport: SPORT[s.key], start, mins, description: lines.join("\n") };
}

function postView(day, s) {
  const v = defaults(day, s);
  const cfg = load(CONFIG);
  const d = show(`<h2 id="sv-title">Post to Strava</h2>
    <div class="form">
      <label>Title <input id="sv-name" value="${esc(v.name)}"></label>
      <label>Type <select id="sv-sport">${Object.entries(SPORT_LABEL).map(([k, l]) =>
        `<option value="${k}"${k === v.sport ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="form-2">
        <label>Start <input id="sv-start" type="datetime-local" value="${v.start}"></label>
        <label>Minutes <input id="sv-mins" type="number" min="1" max="600" inputmode="numeric" value="${v.mins}"></label>
      </div>
      <label>Description <textarea id="sv-desc" rows="8">${esc(v.description)}</textarea></label>
      <p class="sv-msg" id="sv-msg" role="status"></p>
      <div class="dlg-actions"><button class="btn" data-sv-close>Cancel</button><button class="btn strava-btn" id="sv-post">Post</button></div>
      <p class="muted">${cfg.athlete ? `Connected as ${esc(cfg.athlete)}. ` : ""}<button class="linkish" id="sv-forget">Disconnect</button></p>
    </div>`);
  const msg = d.querySelector("#sv-msg");
  d.querySelector("#sv-forget").addEventListener("click", () => {
    try { localStorage.removeItem(CONFIG); } catch { /* ignore */ }
    message("Disconnected. To revoke access completely, remove the app under My Apps in your Strava settings.");
  });
  d.querySelector("#sv-post").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const mins = Number(d.querySelector("#sv-mins").value);
    const start = d.querySelector("#sv-start").value;
    if (!start || !(mins > 0)) {
      msg.textContent = "Fill in a start time and the minutes.";
      return;
    }
    const sport = d.querySelector("#sv-sport").value;
    const body = new URLSearchParams({
      name: d.querySelector("#sv-name").value.trim() || v.name,
      sport_type: sport,
      start_date_local: `${start}:00`,
      elapsed_time: String(Math.round(mins * 60)),
      description: d.querySelector("#sv-desc").value,
    });
    if (sport === "Elliptical") body.set("trainer", "1");
    btn.disabled = true;
    msg.className = "sv-msg";
    msg.textContent = "Posting…";
    try {
      const res = await fetch(`${API}/api/v3/activities`, {
        method: "POST", headers: { Authorization: `Bearer ${await accessToken()}` }, body,
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        const { clientId, clientSecret } = load(CONFIG);
        save(CONFIG, { clientId, clientSecret }); // keep the app, drop the tokens
        throw new Error("Strava no longer accepts this connection. Tap Post to Strava again to reconnect.");
      }
      if (!res.ok) throw new Error(j.message || `Strava answered ${res.status}`);
      const posted = load(POSTED);
      posted[`${day.date}|${s.key}`] = j.id;
      save(POSTED, posted);
      document.querySelectorAll(`[data-strava="${CSS.escape(`${day.date}|${s.key}`)}"]`).forEach((b) => {
        b.closest(".strava-row").outerHTML = postButton(day.date, s);
      });
      show(`<h2 id="sv-title">Posted</h2><p>${esc(body.get("name"))} is on Strava.</p>
        <div class="dlg-actions"><button class="btn" data-sv-close>Close</button>
        <a class="btn strava-btn" href="${API}/activities/${encodeURIComponent(j.id)}" target="_blank" rel="noopener">View on Strava</a></div>`);
    } catch (err) {
      msg.className = "sv-msg err";
      msg.textContent = err.message;
      btn.disabled = false;
    }
  });
}

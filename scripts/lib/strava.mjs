// Minimal, dependency-free Strava API v3 client.
//
// Responsibilities:
//  - refresh the OAuth access token from a long-lived refresh token
//  - make GET requests with automatic retry on 401 (token expired) and 5xx
//  - track Strava's rate-limit headers and stop *before* the app gets banned
//    from the current 15-minute window / day
//
// Strava rate limits (2024+): "overall" and "read" limits, each with a
// 15-minute and a daily bucket. They are reported on every response:
//   X-RateLimit-Limit:      200,2000     (overall: 15-min, daily)
//   X-RateLimit-Usage:      37,412
//   X-ReadRateLimit-Limit:  100,1000     (read-only requests)
//   X-ReadRateLimit-Usage:  37,412
// The 15-minute windows are aligned to the wall clock (:00, :15, :30, :45).

export const DEFAULT_API_BASE = 'https://www.strava.com/api/v3';
export const DEFAULT_TOKEN_URL = 'https://www.strava.com/oauth/token';

export class StravaError extends Error {
  constructor(message, { status, body, path } = {}) {
    super(message);
    this.name = 'StravaError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

/** Thrown when we decide to stop because the rate-limit budget is exhausted. */
export class BudgetExhausted extends Error {
  constructor(message, usage) {
    super(message);
    this.name = 'BudgetExhausted';
    this.usage = usage;
  }
}

function parsePair(header) {
  if (!header) return null;
  const [short, daily] = header.split(',').map((s) => Number(s.trim()));
  if (!Number.isFinite(short) || !Number.isFinite(daily)) return null;
  return { short, daily };
}

/** Milliseconds until the next 15-minute wall-clock boundary (plus a small cushion). */
export function msUntilNextWindow(now = Date.now()) {
  const windowMs = 15 * 60 * 1000;
  return windowMs - (now % windowMs) + 5000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class StravaClient {
  /**
   * @param {object} opts
   * @param {string} opts.clientId
   * @param {string} opts.clientSecret
   * @param {string} opts.refreshToken
   * @param {string} [opts.apiBase]
   * @param {string} [opts.tokenUrl]
   * @param {number} [opts.safetyMargin=5]      requests to leave unused in every bucket
   * @param {number} [opts.maxWaitMs=16*60*1000] longest we are willing to sleep for a new 15-min window (0 = never wait)
   * @param {number} [opts.maxRequests=Infinity] hard cap on requests for this process (useful for tests / partial runs)
   * @param {function} [opts.log]
   * @param {function} [opts.fetchImpl]
   * @param {function} [opts.sleepImpl]
   */
  constructor(opts) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.refreshToken = opts.refreshToken;
    this.apiBase = (opts.apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
    this.tokenUrl = opts.tokenUrl || DEFAULT_TOKEN_URL;
    this.safetyMargin = opts.safetyMargin ?? 5;
    this.maxWaitMs = opts.maxWaitMs ?? 16 * 60 * 1000;
    this.maxRequests = opts.maxRequests ?? Infinity;
    this.log = opts.log || ((...a) => console.error(...a));
    this.fetch = opts.fetchImpl || globalThis.fetch;
    this.sleep = opts.sleepImpl || sleep;
    this.accessToken = null;
    this.expiresAt = 0;
    this.requestCount = 0;
    this.refreshTokenChanged = false;
    // last known usage, updated from response headers
    this.usage = { overall: null, read: null, limits: { overall: null, read: null } };
  }

  async ensureToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.expiresAt - 60 > now) return this.accessToken;
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    });
    const res = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new StravaError(`Token refresh failed (${res.status}): ${text.slice(0, 300)}`, {
        status: res.status,
        body: text,
        path: 'oauth/token',
      });
    }
    const json = JSON.parse(text);
    this.accessToken = json.access_token;
    this.expiresAt = json.expires_at;
    if (json.refresh_token && json.refresh_token !== this.refreshToken) {
      // Strava normally returns the same refresh token. If it ever rotates we
      // must tell the operator to update the stored secret; never print it.
      this.refreshTokenChanged = true;
      this.refreshToken = json.refresh_token;
      this.log('WARNING: Strava returned a new refresh token. Update the STRAVA_REFRESH_TOKEN secret (see README).');
    }
    return this.accessToken;
  }

  _recordUsage(res) {
    const overallLimit = parsePair(res.headers.get('x-ratelimit-limit'));
    const overallUsage = parsePair(res.headers.get('x-ratelimit-usage'));
    const readLimit = parsePair(res.headers.get('x-readratelimit-limit'));
    const readUsage = parsePair(res.headers.get('x-readratelimit-usage'));
    if (overallLimit) this.usage.limits.overall = overallLimit;
    if (overallUsage) this.usage.overall = overallUsage;
    if (readLimit) this.usage.limits.read = readLimit;
    if (readUsage) this.usage.read = readUsage;
  }

  /** Returns 'ok' | 'window' (15-min bucket full) | 'daily' (day bucket full). */
  budgetState() {
    const check = (usage, limit) => {
      if (!usage || !limit) return 'ok';
      if (usage.daily >= limit.daily - this.safetyMargin) return 'daily';
      if (usage.short >= limit.short - this.safetyMargin) return 'window';
      return 'ok';
    };
    const r = check(this.usage.read, this.usage.limits.read);
    if (r !== 'ok') return r;
    return check(this.usage.overall, this.usage.limits.overall);
  }

  async _waitForBudget() {
    const state = this.budgetState();
    if (state === 'ok') return;
    if (state === 'daily') {
      throw new BudgetExhausted('Daily Strava rate limit reached; the next run will continue.', this.usage);
    }
    const wait = msUntilNextWindow();
    if (wait > this.maxWaitMs) {
      throw new BudgetExhausted('15-minute Strava rate limit reached and waiting is disabled; the next run will continue.', this.usage);
    }
    this.log(`Rate-limit window full; sleeping ${(wait / 1000).toFixed(0)}s for the next 15-minute window...`);
    await this.sleep(wait);
    // Usage counters reset with the new window; forget the short counters.
    if (this.usage.read) this.usage.read = { ...this.usage.read, short: 0 };
    if (this.usage.overall) this.usage.overall = { ...this.usage.overall, short: 0 };
  }

  /**
   * GET an API path (relative to apiBase). Returns parsed JSON.
   * Throws StravaError for 4xx (except handled 401/429), BudgetExhausted when out of budget.
   */
  async get(path, params = {}) {
    if (this.requestCount >= this.maxRequests) {
      throw new BudgetExhausted(`Request cap of ${this.maxRequests} reached for this run.`, this.usage);
    }
    await this._waitForBudget();
    const url = new URL(`${this.apiBase}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      attempt += 1;
      const token = await this.ensureToken();
      this.requestCount += 1;
      const res = await this.fetch(url, { headers: { authorization: `Bearer ${token}` } });
      this._recordUsage(res);
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        this.accessToken = null;
        continue;
      }
      if (res.status === 429) {
        // We overshot despite the margin (another process may share the app).
        if (this.usage.read?.daily >= this.usage.limits?.read?.daily || this.usage.overall?.daily >= this.usage.limits?.overall?.daily) {
          throw new BudgetExhausted('HTTP 429: daily Strava rate limit exceeded.', this.usage);
        }
        const wait = msUntilNextWindow();
        if (wait > this.maxWaitMs || attempt > 2) {
          throw new BudgetExhausted('HTTP 429: Strava rate limit exceeded.', this.usage);
        }
        this.log(`HTTP 429; sleeping ${(wait / 1000).toFixed(0)}s for the next window...`);
        await this.sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < 4) {
        const backoff = 1000 * 2 ** attempt;
        this.log(`HTTP ${res.status} on ${path}; retrying in ${backoff / 1000}s`);
        await this.sleep(backoff);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        throw new StravaError(`GET ${path} failed (${res.status}): ${text.slice(0, 300)}`, {
          status: res.status,
          body: text,
          path,
        });
      }
      return text ? JSON.parse(text) : null;
    }
  }

  usageSummary() {
    const fmt = (u, l) => (u && l ? `${u.short}/${l.short} (15 min), ${u.daily}/${l.daily} (day)` : 'unknown');
    return `read ${fmt(this.usage.read, this.usage.limits.read)}; overall ${fmt(this.usage.overall, this.usage.limits.overall)}`;
  }
}

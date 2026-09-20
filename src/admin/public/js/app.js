/* global Alpine */

// Base URL for admin API (relative to dashboard)
const API_BASE = '/admin';
const HEALTH_URL = `${API_BASE}/health`;

let redirectingToLogin = false;

// Without this the session simply expires under an open tab: the browser answers the 401 with its
// own credential prompt, and the page keeps showing data from before the session died.
function redirectToLogin() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  const next = encodeURIComponent(location.pathname + location.hash);
  location.replace(`/admin/login?next=${next}`);
}

class ApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Every admin read reports into this store, so one banner can say "I could not ask" instead of
// each page rendering a failed request as an empty one.
function reportRead(detail) {
  const conn = typeof Alpine === 'undefined' ? null : Alpine.store('connection');
  if (!conn) return;
  conn.detail = detail;
  conn.failed = detail !== null;
  if (detail === null) conn.lastReadAt = new Date();
}

async function apiFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });
  } catch {
    reportRead('the gateway did not answer');
    throw new ApiError('the gateway did not answer');
  }
  if (res.status === 401) redirectToLogin();
  reportRead(res.ok ? null : `the gateway answered ${res.status}`);
  return res;
}

// What a read path uses. It answers with the body or throws — the three states a table has to
// tell apart (loading, unreachable, genuinely empty) are not expressible while a failed fetch
// and an empty one both return nothing.
async function apiRead(url, options = {}) {
  const res = await apiFetch(url, options);
  if (!res.ok) throw new ApiError(`the gateway answered ${res.status}`, res.status);
  return res.json();
}

function formatUptime(seconds) {
  if (!seconds) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatCompactNumber(n) {
  if (n == null) return '-';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd) {
  if (usd == null || usd === 0) return '-';
  return `$${usd.toFixed(4)}`;
}

// Two shapes reach this: SQLite's "2026-09-20 02:04:45", which is UTC with nothing saying so,
// and the updater's "2026-09-20T02:04:45Z", which says so already. Appending Z to the second one
// makes it unparseable, and the System page printed "NaN/NaN NaN:NaN:NaN" for every finished
// update because of it.
function formatTime(isoString) {
  if (!isoString) return '-';
  const text = String(isoString);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '-';
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mon}/${day} ${hh}:${mm}:${ss}`;
}

// Wall-clock only: this answers "how stale is what I am looking at", never which day it was.
function formatClock(date) {
  if (!date) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function statusBadgeClass(status) {
  if (status >= 200 && status < 300) return 'badge-2xx';
  if (status >= 400 && status < 500) return 'badge-4xx';
  return 'badge-5xx';
}

const VALID_PAGES = ['overview', 'logs', 'keys', 'playground', 'system'];

// Read-only state crosses component boundaries through Alpine's scope inheritance, but a write
// from a child would shadow the parent's property instead of changing it. A store is the only
// shared state here for that reason.
document.addEventListener('alpine:init', () => {
  Alpine.store('nav', { pendingLogFilter: null });
  Alpine.store('connection', {
    online: navigator.onLine,
    failed: false,
    detail: null,
    lastReadAt: null,
    get degraded() { return !this.online || this.failed; },
    get message() {
      if (!this.online) return 'This browser is offline. Nothing below is being updated.';
      return `Could not reach the gateway — ${this.detail}. Nothing below is being updated.`;
    },
  });
  for (const event of ['online', 'offline']) {
    window.addEventListener(event, () => { Alpine.store('connection').online = navigator.onLine; });
  }
});

function app() {
  return {
    page: VALID_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
    sidebarOpen: false,
    health: { uptime: null, providers: {}, queue: {} },
    healthRead: 'pending',
    nav: [
      { id: 'overview', label: 'Overview', icon: 'dashboard' },
      { id: 'logs', label: 'Request Logs', icon: 'database' },
      { id: 'keys', label: 'API Keys', icon: 'key' },
      { id: 'playground', label: 'Playground', icon: 'terminal' },
      { id: 'system', label: 'System', icon: 'settings_heart' },
    ],
    navigate(pageId) {
      this.page = pageId;
      this.sidebarOpen = false;
      location.hash = pageId;
    },
    openLogsFiltered(filter) {
      Alpine.store('nav').pendingLogFilter = typeof filter === 'object' ? filter : { status: String(filter) };
      this.navigate('logs');
    },
    formatUptime,
    formatClock,
    get lastReadAt() { return formatClock(Alpine.store('connection').lastReadAt); },
    async init() {
      window.addEventListener('hashchange', () => {
        const id = location.hash.slice(1);
        if (VALID_PAGES.includes(id)) this.page = id;
      });
      await this.fetchHealth();
      setInterval(() => this.fetchHealth(), 30000);
    },
    // Keeping the last good reading and saying nothing is how the one element whose job is to
    // report the server is alive went on saying so after it died.
    async fetchHealth() {
      try {
        const data = await apiRead(HEALTH_URL);
        this.health = {
          uptime: data.uptime_seconds,
          providers: data.providers || {},
          queue: data.queue || {},
          status: data.status,
          build: data.build || null,
        };
        this.healthRead = 'ok';
      } catch {
        this.healthRead = 'failed';
      }
    },
  };
}

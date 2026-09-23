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

// A tab nobody is looking at must stop asking. At the intervals this control offers, a dashboard
// left open overnight would spend the night querying the same event loop that proxies the CLIs.
// Every page-level read goes through one of these, so the rule is written once.
function poller(read) {
  let id = null;
  let ms = 0;

  const clear = () => { if (id !== null) { clearInterval(id); id = null; } };
  const arm = () => { clear(); if (ms > 0 && !document.hidden) id = setInterval(read, ms); };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return clear();
    // Returning to a page that stopped reading has to show current data, not wait out a period.
    if (ms > 0) { read(); arm(); }
  });

  return {
    // Idempotent on purpose: the Alpine effects that call this re-run on every read, and a loop
    // that restarts its own countdown each time it completes never reaches the next one.
    every(next) {
      if (next === ms && id !== null) return;
      ms = next;
      arm();
    },
    stop() { ms = 0; clear(); },
  };
}

const REFRESH_LADDER = [
  { ms: 0, label: 'Off' },
  { ms: 10000, label: '10s' },
  { ms: 30000, label: '30s' },
  { ms: 60000, label: '1m' },
  { ms: 300000, label: '5m' },
];

// A private window, blocked site data or a thumbnail capture makes storage throw rather than
// answer, and a remembered preference is never worth failing a page over. A missing key has to be
// told apart from a stored zero, because zero is a real rung of the ladder.
function storedInterval(key, fallback) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;
  const ms = Number(raw);
  return REFRESH_LADDER.some((step) => step.ms === ms) ? ms : fallback;
}

function storeInterval(key, ms) {
  try { localStorage.setItem(key, String(ms)); } catch { /* the loop still runs unremembered */ }
}

// navigator.clipboard is absent on an insecure origin, which a self-hosted install reached over
// plain http on a LAN address is — a caller has to be able to say so instead of appearing to work.
async function copyToClipboard(text) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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

// Whose clock the page speaks. The browser's used to, so the same dashboard read differently
// from a laptop abroad and disagreed with the buckets. This is the fallback until health answers.
let dashboardTimezone = 'America/Mexico_City';

function setDashboardTimezone(tz) {
  if (tz) dashboardTimezone = tz;
}

// Two shapes reach this: SQLite's "2026-09-20 02:04:45", which is UTC with nothing saying so,
// and the updater's "2026-09-20T02:04:45Z", which says so already. Appending Z to the second one
// makes it unparseable, and the System page printed "NaN/NaN NaN:NaN:NaN" for every finished
// update because of it.
function parseInstant(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: dashboardTimezone,
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function formatTime(isoString) {
  const d = parseInstant(isoString);
  if (!d) return '-';
  const p = zonedParts(d);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function formatHourMinute(value) {
  const d = parseInstant(value);
  if (!d) return '';
  const p = zonedParts(d);
  return `${p.hour}:${p.minute}`;
}

function formatDayHour(value) {
  const d = parseInstant(value);
  if (!d) return '';
  const p = zonedParts(d);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

// "09/19 07:14" needs arithmetic before it answers the only question being asked of it: is this
// still happening. The exact time stays on the element's title, because triage needs both.
function formatRelative(value, now = Date.now()) {
  const d = parseInstant(value);
  if (!d) return '-';

  const seconds = Math.round((now - d.getTime()) / 1000);
  if (seconds < 45) return 'just now';

  // Floored, so "2 hrs ago" means two hours have passed rather than one and a half rounded up.
  const units = [
    { limit: 3600, size: 60, name: 'min' },
    { limit: 86400, size: 3600, name: 'hr' },
    { limit: Infinity, size: 86400, name: 'day' },
  ];
  const unit = units.find((u) => seconds < u.limit);
  const n = Math.max(1, Math.floor(seconds / unit.size));
  return `${n} ${unit.name}${n === 1 ? '' : 's'} ago`;
}

// Wall-clock only: this answers "how stale is what I am looking at", never which day it was.
function formatClock(date) {
  const d = parseInstant(date);
  if (!d) return null;
  const p = zonedParts(d);
  return `${p.hour}:${p.minute}:${p.second}`;
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
      this.show(pageId);
      this.sidebarOpen = false;
      location.hash = pageId;
    },
    // Never smooth: this fires on every navigation, and it delays the first read of a page the
    // operator opened to read.
    show(pageId) {
      this.page = pageId;
      window.scrollTo(0, 0);
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
        if (VALID_PAGES.includes(id)) this.show(id);
      });
      await this.fetchHealth();
      this._health = poller(() => this.fetchHealth());
      this._health.every(30000);
    },
    // Keeping the last good reading and saying nothing is how the one element whose job is to
    // report the server is alive went on saying so after it died.
    async fetchHealth() {
      try {
        const data = await apiRead(HEALTH_URL);
        setDashboardTimezone(data.timezone);
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

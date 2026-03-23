/* global Alpine */

// Base URL for admin API (relative to dashboard)
const API_BASE = '/admin';
const HEALTH_URL = '/health';

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
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

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString + 'Z');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mon}/${day} ${hh}:${mm}:${ss}`;
}

function statusBadgeClass(status) {
  if (status >= 200 && status < 300) return 'badge-2xx';
  if (status >= 400 && status < 500) return 'badge-4xx';
  return 'badge-5xx';
}

const VALID_PAGES = ['overview', 'playground', 'logs', 'keys', 'models'];

function app() {
  return {
    page: VALID_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
    health: { uptime: null, providers: {}, queue: {} },
    nav: [
      { id: 'overview', label: 'Overview', icon: 'dashboard' },
      { id: 'playground', label: 'Playground', icon: 'terminal' },
      { id: 'logs', label: 'Request Logs', icon: 'database' },
      { id: 'keys', label: 'API Keys', icon: 'key' },
      { id: 'models', label: 'Models', icon: 'memory' },
    ],
    navigate(pageId) {
      this.page = pageId;
      location.hash = pageId;
    },
    formatUptime,
    async init() {
      window.addEventListener('hashchange', () => {
        const id = location.hash.slice(1);
        if (VALID_PAGES.includes(id)) this.page = id;
      });
      await this.fetchHealth();
      setInterval(() => this.fetchHealth(), 30000);
    },
    async fetchHealth() {
      try {
        const res = await fetch(HEALTH_URL);
        if (res.ok) {
          const data = await res.json();
          this.health = {
            uptime: data.uptime_seconds,
            providers: data.providers || {},
            queue: data.queue || {},
            status: data.status,
          };
        }
      } catch { /* ignore */ }
    },
  };
}

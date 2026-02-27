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
  return d.toLocaleString();
}

function statusBadgeClass(status) {
  if (status >= 200 && status < 300) return 'badge-2xx';
  if (status >= 400 && status < 500) return 'badge-4xx';
  return 'badge-5xx';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function app() {
  return {
    page: 'overview',
    health: { uptime: null, providers: {}, queue: {} },
    nav: [
      { id: 'overview', label: 'Overview' },
      { id: 'logs', label: 'Request Logs' },
      { id: 'keys', label: 'API Keys' },
      { id: 'models', label: 'Models' },
    ],
    navigate(pageId) {
      this.page = pageId;
    },
    formatUptime,
    async init() {
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

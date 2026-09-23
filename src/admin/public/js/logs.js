/* global Alpine */

const LOGS_REFRESH_KEY = 'shellm.refresh.logs';

// A local read finishes in tens of milliseconds. A spinner that runs only that long is a twitch
// rather than feedback, so a manual press holds it for at least this.
const SPINNER_FLOOR_MS = 400;

function logsPage() {
  return {
    logs: [],
    total: 0,
    limit: 25,
    offset: 0,
    filterProvider: '',
    filterStatus: '',
    filterClient: '',
    filterModel: '',
    filterErrorCode: '',
    expandedId: null,
    loading: true,
    manualLoading: false,
    loadError: null,
    refreshMs: storedInterval(LOGS_REFRESH_KEY, 0),
    ladder: REFRESH_LADDER,
    _poller: null,
    stats: null,
    statsError: null,

    applyPendingFilter() {
      const nav = Alpine.store('nav');
      if (!nav.pendingLogFilter) return false;
      const wanted = nav.pendingLogFilter;
      this.filterStatus = wanted.status || '';
      this.filterClient = wanted.client || '';
      this.filterModel = wanted.model || '';
      this.filterErrorCode = wanted.error_code || '';
      this.offset = 0;
      nav.pendingLogFilter = null;
      this.fetchLogs();
      return true;
    },

    toggleRow(id) {
      this.expandedId = this.expandedId === id ? null : id;
    },

    async fetchLogs({ manual = true } = {}) {
      const startedAt = Date.now();
      this.loading = true;
      if (manual) this.manualLoading = true;
      const params = new URLSearchParams();
      params.set('limit', this.limit);
      params.set('offset', this.offset);
      this.appendFilters(params);

      try {
        const data = await apiRead(`${API_BASE}/logs?${params}`);
        this.logs = data.logs;
        this.total = data.total;
        this.loadError = null;
      } catch (err) {
        this.logs = [];
        this.total = 0;
        this.loadError = err.message;
      }
      this.loading = false;
      if (manual) this.settleSpinner(startedAt);
    },

    settleSpinner(startedAt) {
      const remaining = SPINNER_FLOOR_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        this.manualLoading = false;
        return;
      }
      setTimeout(() => { this.manualLoading = false; }, remaining);
    },

    refreshNow() {
      this.fetchLogs();
      this.fetchStats();
    },

    startAutoRefresh() {
      if (!this._poller) {
        this._poller = poller(() => {
          if (this.autoRefreshHeld) return;
          this.fetchLogs({ manual: false });
          this.fetchStats();
        });
      }
      this._poller.every(this.refreshMs);
    },

    stopAutoRefresh() {
      if (this._poller) this._poller.stop();
    },

    setRefresh(value) {
      this.refreshMs = Number(value);
      storeInterval(LOGS_REFRESH_KEY, this.refreshMs);
      this.startAutoRefresh();
    },

    // Replacing the rows under someone who is reading one of them, or who has paged away from the
    // top, is the cost this loop is not allowed to charge.
    get autoRefreshHeld() {
      return this.refreshMs > 0 && (this.offset > 0 || this.expandedId !== null);
    },

    get intervalTitle() {
      if (this.refreshMs === 0) return 'Auto-refresh is off';
      if (this.expandedId !== null) return 'Paused while a row is open';
      if (this.offset > 0) return 'Paused while you are past page 1';
      return 'How often the table re-reads itself';
    },

    appendFilters(params) {
      if (this.filterProvider) params.set('provider', this.filterProvider);
      if (this.filterStatus) params.set('status', this.filterStatus);
      if (this.filterClient) params.set('client', this.filterClient);
      if (this.filterModel) params.set('model', this.filterModel);
      if (this.filterErrorCode) params.set('error_code', this.filterErrorCode);
    },

    clearFilters() {
      this.filterProvider = '';
      this.filterStatus = '';
      this.filterClient = '';
      this.filterModel = '';
      this.filterErrorCode = '';
      this.applyFilters();
    },

    get hasFilters() {
      return !!(this.filterProvider || this.filterStatus || this.filterClient || this.filterModel || this.filterErrorCode);
    },

    // Both figures below the table read the one window /admin/stats measures, so the panel says
    // which one rather than naming a period it does not cover.
    windowSpan() {
      const hours = this.stats?.window?.hours || 0;
      if (!hours) return '';
      if (hours < 1) return `last ${Math.round(hours * 60)} min`;
      if (hours < 48) return `last ${Math.round(hours)} h`;
      return `last ${Math.round(hours / 24)} days`;
    },

    get clientOptions() {
      return (this.stats?.by_client || []).map((c) => c.client_name).filter((n) => n && n !== '(unknown)');
    },

    get modelOptions() {
      return (this.stats?.by_model || []).map((m) => m.model).filter(Boolean);
    },

    async fetchStats() {
      try {
        this.stats = await apiRead(`${API_BASE}/stats`);
        this.statsError = null;
      } catch (err) {
        this.stats = null;
        this.statsError = err.message;
      }
    },

    async clearLogs() {
      if (!confirm('Delete all request logs? This cannot be undone.')) return;
      try {
        const res = await apiFetch(`${API_BASE}/logs`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          return alert(err.message || 'Failed to clear logs');
        }
        this.logs = [];
        this.total = 0;
        this.offset = 0;
      } catch { alert('Network error'); }
    },

    async applyFilters() {
      this.offset = 0;
      await this.fetchLogs();
    },

    async changeLimit(newLimit) {
      this.limit = parseInt(newLimit, 10);
      this.offset = 0;
      await this.fetchLogs();
    },

    async goToPage(page) {
      const p = Math.max(1, Math.min(page, this.totalPages));
      this.offset = (p - 1) * this.limit;
      await this.fetchLogs();
    },

    async prevPage() {
      if (this.offset > 0) {
        this.offset = Math.max(0, this.offset - this.limit);
        await this.fetchLogs();
      }
    },

    async nextPage() {
      if (this.offset + this.limit < this.total) {
        this.offset += this.limit;
        await this.fetchLogs();
      }
    },

    get currentPage() {
      return Math.floor(this.offset / this.limit) + 1;
    },

    get totalPages() {
      return Math.max(1, Math.ceil(this.total / this.limit));
    },

    get visiblePages() {
      const current = this.currentPage;
      const total = this.totalPages;
      const pages = [];
      let start = Math.max(1, current - 2);
      let end = Math.min(total, current + 2);
      // Ensure we show at least 5 pages when possible
      if (end - start < 4) {
        if (start === 1) end = Math.min(total, start + 4);
        else if (end === total) start = Math.max(1, end - 4);
      }
      for (let i = start; i <= end; i++) pages.push(i);
      return pages;
    },

    exportCSV() {
      const params = new URLSearchParams();
      params.set('format', 'csv');
      this.appendFilters(params);
      window.location.href = `${API_BASE}/logs/export?${params}`;
    },

    formatTime,
    formatDuration,
    formatCost,
    formatCompactNumber,
    statusBadgeClass,
  };
}

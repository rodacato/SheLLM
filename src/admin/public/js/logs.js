/* global Alpine */

const LOGS_REFRESH_KEY = 'shellm.refresh.logs';

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
    deleteError: null,
    copied: null,
    copyError: null,
    _inFlightSnapshot: null,
    _liveInFlightIds: null,

    applyPendingFilter() {
      const nav = Alpine.store('nav');
      if (!nav.pendingLogFilter) return false;
      const wanted = nav.pendingLogFilter;
      this.filterProvider = '';
      this.filterStatus = wanted.status || '';
      this.filterClient = wanted.client || '';
      this.filterModel = wanted.model || '';
      this.filterErrorCode = wanted.error_code || '';
      this.offset = 0;
      this.expandedId = null;
      nav.pendingLogFilter = null;
      return true;
    },

    toggleRow(id) {
      if (!this.inFlightFrozen) this.freezeInFlight();
      this.expandedId = this.expandedId === id ? null : id;
    },

    async copy(id, text) {
      if (await copyToClipboard(text)) {
        this.copied = id;
        this.copyError = null;
        setTimeout(() => { if (this.copied === id) this.copied = null; }, 1500);
        return;
      }
      this.copyError = id;
      this.copied = null;
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
      this.freezeInFlight();
      this.loading = false;
      if (manual) this.settleSpinner(startedAt);
    },

    settleSpinner(startedAt) {
      const remaining = spinnerRemaining(startedAt);
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

    // `now` so a revisit reads at once instead of showing the rows from the last visit.
    startAutoRefresh() {
      if (!this._poller) {
        this._poller = poller(() => {
          if (this.autoRefreshHeld) return;
          this.fetchLogs({ manual: false });
          this.fetchStats();
        });
      }
      this._poller.every(this.refreshMs, { now: true });
    },

    stopAutoRefresh() {
      if (this._poller) this._poller.stop();
    },

    setRefresh(value) {
      if (!this.inFlightFrozen) this.freezeInFlight();
      this.refreshMs = Number(value);
      storeInterval(LOGS_REFRESH_KEY, this.refreshMs);
      this.startAutoRefresh();
    },

    // The queue is read on the health poll's clock, not the table's. Where the table is not
    // moving, the in-flight rows above it must not move either — their ages still tick.
    get inFlightFrozen() {
      return this.refreshMs === 0 || this.autoRefreshHeld;
    },

    freezeInFlight() {
      this._inFlightSnapshot = this.healthRead === 'ok'
        ? { jobs: this.inFlight, readAt: this.health.readAt }
        : null;
    },

    get shownInFlight() {
      if (this.inFlightFrozen && this._inFlightSnapshot) return this._inFlightSnapshot.jobs;
      return this.inFlight;
    },

    get shownInFlightReadAt() {
      if (this.inFlightFrozen && this._inFlightSnapshot) return this._inFlightSnapshot.readAt;
      return this.health.readAt;
    },

    shownJobAge(job) { return inFlightAge(job, this.shownInFlightReadAt, this.now); },
    shownJobStartedAt(job) { return new Date(this.shownInFlightReadAt - job.age_ms); },
    shownJobNearTimeout(job) {
      return isNearTimeout(job, this.shownJobAge(job), this.health.queue?.timeout_ms);
    },

    // A request leaves the queue the moment its log row is written, so a departure is the one
    // signal that the table is behind. Not while someone is reading a row or a later page.
    noticeInFlight() {
      if (this.healthRead !== 'ok') return;
      const ids = this.inFlight.map((job) => job.request_id).join(',');
      const previous = this._liveInFlightIds;
      if (ids === previous) return;
      this._liveInFlightIds = ids;
      if (this._inFlightSnapshot === null) this.freezeInFlight();
      if (previous === null) return;
      const current = new Set(ids.split(','));
      const finished = previous.split(',').some((id) => id && !current.has(id));
      if (finished && this.offset === 0 && this.expandedId === null) this.fetchLogs({ manual: false });
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

    // The band above the table reads /admin/stats, which takes no filters, so it names its window
    // and says it ignores the filters above it rather than appearing to answer them.
    windowSpan() {
      const hours = this.stats?.window?.hours || 0;
      if (!hours) return '';
      if (hours < 1) return `last ${Math.round(hours * 60)} min · not filtered`;
      if (hours < 48) return `last ${Math.round(hours)} h · not filtered`;
      return `last ${Math.round(hours / 24)} days · not filtered`;
    },

    // Height is volume; the red share inside it is the errors, so one failure in a busy
    // bucket does not paint the whole bar as if everything failed.
    get sparkBuckets() {
      const buckets = (this.stats?.timeline || []).slice(-15);
      const peak = Math.max(1, ...buckets.map((b) => b.requests || 0));
      return buckets.map((b) => ({
        height: Math.max(8, Math.min(100, ((b.requests || 0) / peak) * 100)),
        errorShare: b.requests > 0 ? Math.min(100, ((b.errors || 0) / b.requests) * 100) : 0,
      }));
    },

    // Filters that arrive from Overview or Keys can hold values no select offers (an exact 429,
    // an error code), so those are listed where the operator can see and drop them.
    get hiddenFilters() {
      const hidden = [];
      if (this.filterStatus && !['2', '4', '5'].includes(this.filterStatus)) {
        hidden.push({ key: 'filterStatus', label: 'Status', value: this.filterStatus });
      }
      if (this.filterClient && !this.clientOptions.includes(this.filterClient)) {
        hidden.push({ key: 'filterClient', label: 'Client', value: this.filterClient });
      }
      if (this.filterModel && !this.modelOptions.includes(this.filterModel)) {
        hidden.push({ key: 'filterModel', label: 'Model', value: this.filterModel });
      }
      if (this.filterErrorCode) {
        hidden.push({ key: 'filterErrorCode', label: 'Error', value: this.filterErrorCode });
      }
      return hidden;
    },

    dropFilter(key) {
      this[key] = '';
      this.applyFilters();
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
      this.deleteError = null;
      try {
        await apiWrite(`${API_BASE}/logs`, { method: 'DELETE' });
      } catch (err) {
        this.deleteError = `Could not delete the logs — ${err.message}`;
        return;
      }
      this.offset = 0;
      this.expandedId = null;
      this.refreshNow();
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

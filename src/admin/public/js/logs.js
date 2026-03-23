function logsPage() {
  return {
    logs: [],
    total: 0,
    limit: 25,
    offset: 0,
    filterProvider: '',
    filterStatus: '',
    loading: true,
    stats: null,

    async fetchLogs() {
      this.loading = true;
      const params = new URLSearchParams();
      params.set('limit', this.limit);
      params.set('offset', this.offset);
      if (this.filterProvider) params.set('provider', this.filterProvider);
      if (this.filterStatus) params.set('status', this.filterStatus);

      try {
        const res = await apiFetch(`${API_BASE}/logs?${params}`);
        if (res.ok) {
          const data = await res.json();
          this.logs = data.logs;
          this.total = data.total;
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    async fetchStats() {
      try {
        const res = await apiFetch(`${API_BASE}/stats?period=24h`);
        if (res.ok) {
          this.stats = await res.json();
        }
      } catch { /* ignore */ }
    },

    async clearLogs() {
      if (!confirm('Delete all request logs? This cannot be undone.')) return;
      try {
        const res = await apiFetch(`${API_BASE}/logs`, { method: 'DELETE' });
        if (res.ok) {
          this.logs = [];
          this.total = 0;
          this.offset = 0;
        }
      } catch { /* ignore */ }
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
      if (this.filterProvider) params.set('provider', this.filterProvider);
      if (this.filterStatus) params.set('status', this.filterStatus);
      window.location.href = `${API_BASE}/logs/export?${params}`;
    },

    formatTime,
    formatDuration,
    formatCost,
    formatCompactNumber,
    statusBadgeClass,
  };
}

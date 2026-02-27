function logsPage() {
  return {
    logs: [],
    total: 0,
    limit: 50,
    offset: 0,
    filterProvider: '',
    filterStatus: '',
    loading: true,

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

    formatTime,
    formatDuration,
    formatCost,
    statusBadgeClass,
  };
}

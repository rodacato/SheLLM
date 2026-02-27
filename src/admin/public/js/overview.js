function overviewPage() {
  return {
    stats: null,
    period: '24h',
    loading: true,

    async fetchStats() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/stats?period=${this.period}`);
        if (res.ok) this.stats = await res.json();
      } catch { /* ignore */ }
      this.loading = false;
    },

    async changePeriod(p) {
      this.period = p;
      await this.fetchStats();
    },

    formatCost,
    formatDuration,
  };
}

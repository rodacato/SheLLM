function overviewPage() {
  return {
    stats: null,
    period: '24h',
    loading: true,
    providers: [],

    async fetchStats() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/stats?period=${this.period}`);
        if (res.ok) this.stats = await res.json();
      } catch { /* ignore */ }
      this.loading = false;
    },

    async fetchProviders() {
      try {
        const res = await apiFetch(`${API_BASE}/providers`);
        if (res.ok) {
          const data = await res.json();
          this.providers = data.providers;
        }
      } catch { /* ignore */ }
    },

    async toggleProvider(name, currentEnabled) {
      try {
        await apiFetch(`${API_BASE}/providers/${name}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: currentEnabled ? 0 : 1 }),
        });
        await this.fetchProviders();
        if (this.$root && this.$root.fetchHealth) await this.$root.fetchHealth();
      } catch { /* ignore */ }
    },

    async changePeriod(p) {
      this.period = p;
      await this.fetchStats();
    },

    formatCost,
    formatDuration,
    formatTime,
  };
}

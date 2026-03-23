function overviewPage() {
  return {
    stats: null,
    period: '24h',
    loading: true,
    providers: [],
    _charts: {},
    _refreshInterval: null,

    async fetchStats() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/stats?period=${this.period}`);
        if (res.ok) {
          this.stats = await res.json();
          this.$nextTick(() => this.renderSparklines());
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    startAutoRefresh() {
      if (this._refreshInterval) return;
      this._refreshInterval = setInterval(() => this.fetchStats(), 30000);
    },

    stopAutoRefresh() {
      if (this._refreshInterval) {
        clearInterval(this._refreshInterval);
        this._refreshInterval = null;
      }
    },

    renderSparklines() {
      if (!this.stats?.timeline || this.stats.timeline.length < 2) return;
      if (typeof Chart === 'undefined') return;

      const labels = this.stats.timeline.map(t => t.bucket);
      const baseConfig = {
        type: 'line',
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, beginAtZero: true },
          },
          elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 1.5 } },
          animation: false,
        },
      };

      this._renderChart('sparkRequests', labels,
        this.stats.timeline.map(t => t.requests), '#03e3ff', 'rgba(3,227,255,0.1)');
      this._renderChart('sparkErrors', labels,
        this.stats.timeline.map(t => t.errors), '#ef4444', 'rgba(239,68,68,0.1)');
      this._renderChart('sparkCost', labels,
        this.stats.timeline.map(t => t.cost), '#03e3ff', 'rgba(3,227,255,0.1)');
    },

    _renderChart(refName, labels, data, borderColor, bgColor) {
      const canvas = this.$refs[refName];
      if (!canvas) return;

      if (this._charts[refName]) {
        this._charts[refName].destroy();
      }

      this._charts[refName] = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data,
            borderColor,
            backgroundColor: bgColor,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, beginAtZero: true },
          },
          elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 1.5 } },
          animation: false,
        },
      });
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

    async changePeriod(p) {
      this.period = p;
      await this.fetchStats();
    },

    formatCost,
    formatDuration,
    formatTime,
  };
}

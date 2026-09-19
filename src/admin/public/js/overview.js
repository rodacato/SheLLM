const STATUS_COLORS = { ok: '#22c55e', client: '#ffb800', server: '#ef4444' };

function statusColor(status) {
  if (status < 400) return STATUS_COLORS.ok;
  return status < 500 ? STATUS_COLORS.client : STATUS_COLORS.server;
}

function overviewPage() {
  return {
    stats: null,
    period: '24h',
    loading: true,
    providers: [],
    _chart: null,
    _refreshInterval: null,

    async fetchStats() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/stats?period=${this.period}`);
        if (res.ok) {
          this.stats = await res.json();
          this.$nextTick(() => this.renderScatter());
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

    queueSaturation() {
      const q = this.health?.queue;
      if (!q || !q.max_concurrent) return 0;
      return Math.min(100, Math.round((q.active / q.max_concurrent) * 100));
    },

    layerPct(layer) {
      const l = this.stats?.latency;
      if (!l) return 0;
      const queued = l.queued_ms?.p95 || 0;
      const execution = l.execution_ms?.p95 || 0;
      const total = queued + execution;
      if (total === 0) return layer === 'execution_ms' ? 100 : 0;
      return Math.round(((layer === 'queued_ms' ? queued : execution) / total) * 100);
    },

    // The whole point of the split: queueing is fixed by raising concurrency, execution is not.
    lagVerdict() {
      const queuedPct = this.layerPct('queued_ms');
      if (!this.stats?.latency?.total_ms?.p95) return 'no data yet';
      if (queuedPct >= 40) return `${queuedPct}% spent queueing — raise MAX_CONCURRENT`;
      if (queuedPct >= 15) return `${queuedPct}% queueing — concurrency is starting to bite`;
      return 'the CLI, not the queue';
    },

    renderScatter() {
      const rows = this.stats?.recent_requests;
      const canvas = this.$refs.scatter;
      if (!canvas || !rows || rows.length < 2 || typeof Chart === 'undefined') return;

      if (this._chart) this._chart.destroy();

      const points = rows.map((r) => ({
        x: new Date(r.created_at + 'Z').getTime(),
        y: r.duration_ms,
        status: r.status,
        model: r.model,
        queued: r.queued_ms,
      }));

      this._chart = new Chart(canvas, {
        type: 'scatter',
        data: {
          datasets: [{
            data: points,
            pointBackgroundColor: points.map((p) => statusColor(p.status)),
            pointBorderColor: 'transparent',
            pointRadius: 3,
            pointHoverRadius: 5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const p = ctx.raw;
                  const queued = p.queued ? ` · ${p.queued}ms queued` : '';
                  return `${p.status} · ${formatDuration(p.y)}${queued} · ${p.model || 'unknown'}`;
                },
                title: (items) => new Date(items[0].raw.x).toLocaleString(),
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              grid: { color: 'rgba(132,147,151,0.1)' },
              ticks: {
                color: '#849397',
                font: { size: 10, family: 'monospace' },
                maxTicksLimit: 6,
                callback: (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(132,147,151,0.1)' },
              ticks: {
                color: '#849397',
                font: { size: 10, family: 'monospace' },
                callback: (value) => formatDuration(value),
              },
            },
          },
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

/* global Alpine */
// Chart.js takes colour values, not classes, so it reads the same custom properties the
// Tailwind tokens are built from instead of keeping a second copy of the scale.
const statusVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function statusColor(status) {
  if (status < 400) return statusVar('--status-ok');
  return status < 500 ? statusVar('--status-warn') : statusVar('--status-fail');
}

function overviewPage() {
  return {
    stats: null,
    statsError: null,
    loading: true,
    providers: [],
    providersError: null,
    providersLoaded: false,
    _chart: null,
    _timelineChart: null,
    _refreshInterval: null,

    async fetchStats() {
      this.loading = true;
      try {
        this.stats = await apiRead(`${API_BASE}/stats`);
        this.statsError = null;
        this.$nextTick(() => {
          this.renderScatter();
          this.renderTimeline();
        });
      } catch (err) {
        this.statsError = err.message;
      }
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

    get errorRows() {
      return this.stats?.error_breakdown || [];
    },

    openErrorLogs(row) {
      Alpine.store('nav').pendingLogFilter = {
        status: String(row.status),
        error_code: row.error_code === '(none)' ? '' : row.error_code,
        client: row.client_name === '(unauthenticated)' ? '' : row.client_name,
      };
      location.hash = 'logs';
    },

    renderTimeline() {
      const rows = this.stats?.timeline;
      const canvas = this.$refs.timeline;
      if (!canvas || !rows || rows.length < 2 || typeof Chart === 'undefined') return;

      if (this._timelineChart) this._timelineChart.destroy();

      const labels = rows.map((r) => formatDayHour(r.bucket_at));
      this._timelineChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'requests',
              data: rows.map((r) => r.requests),
              borderColor: statusVar('--status-ok'),
              backgroundColor: statusVar('--status-ok-fill'),
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 4,
            },
            {
              label: 'errors',
              data: rows.map((r) => r.errors),
              borderColor: statusVar('--status-fail'),
              backgroundColor: 'transparent',
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              labels: { color: '#849397', font: { size: 10, family: 'monospace' }, boxWidth: 10 },
            },
          },
          scales: {
            x: {
              grid: { color: 'rgba(132,147,151,0.1)' },
              ticks: { color: '#849397', font: { size: 10, family: 'monospace' }, maxTicksLimit: 8 },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(132,147,151,0.1)' },
              ticks: { color: '#849397', font: { size: 10, family: 'monospace' }, precision: 0 },
            },
          },
        },
      });
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
                title: (items) => formatTime(new Date(items[0].raw.x)),
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
                callback: (value) => formatHourMinute(new Date(value)),
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
        const data = await apiRead(`${API_BASE}/providers`);
        this.providers = data.providers || [];
        this.providersError = null;
      } catch (err) {
        this.providersError = err.message;
      }
      this.providersLoaded = true;
    },

    // The page no longer asks for a period, so it has to say which one it got. Without this the
    // percentages and the totals have no denominator on screen.
    windowSpan() {
      const hours = this.stats?.window?.hours || 0;
      if (!hours) return 'no requests yet';
      if (hours < 1) return `${Math.round(hours * 60)} min`;
      if (hours < 48) return `${Math.round(hours)} h`;
      return `${Math.round(hours / 24)} days`;
    },

    formatCost,
    formatDuration,
    formatTime,
  };
}

/* global Alpine */
// Chart.js takes colour values, not classes, so it reads the same custom properties the
// Tailwind tokens are built from instead of keeping a second copy of the scale.
const statusVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function statusColor(status) {
  if (status < 400) return statusVar('--status-ok');
  return status < 500 ? statusVar('--status-warn') : statusVar('--status-fail');
}

// Chart.js ships no annotation layer and the plugin that does is another dependency for one
// dashed line, so the line is drawn here. Inline, so only the charts that pass it get it.
const nowMarker = {
  id: 'nowMarker',
  afterDatasetsDraw(chart) {
    const at = chart.options.plugins?.nowMarker?.at;
    if (!at) return;
    const { ctx, chartArea } = chart;
    const x = chart.scales.x.getPixelForValue(at);
    if (x < chartArea.left || x > chartArea.right) return;

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = statusVar('--outline');
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = statusVar('--outline');
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('now', x - 4, chartArea.top + 9);
    ctx.restore();
  },
};

const axisTicks = () => ({ color: statusVar('--outline'), font: { size: 10, family: 'monospace' } });

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
    _domain: null,
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

      const domain = this.timeDomain();
      // tension smoothed a one-hour spike into a two-hour ramp that never happened
      const series = (key, color, fill) => ({
        label: key,
        data: rows.map((r) => ({ x: Date.parse(r.bucket_at), y: r[key] })),
        borderColor: statusVar(color),
        backgroundColor: fill ? statusVar(fill) : 'transparent',
        fill: Boolean(fill),
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
      });

      this._timelineChart = new Chart(canvas, {
        type: 'line',
        plugins: [nowMarker],
        data: {
          datasets: [
            series('requests', '--status-ok', '--status-ok-fill'),
            series('errors', '--status-fail', null),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            nowMarker: { at: domain.now },
            legend: {
              display: true,
              labels: { ...axisTicks(), boxWidth: 10 },
            },
            tooltip: {
              callbacks: { title: (items) => formatTime(new Date(items[0].parsed.x)) },
            },
          },
          scales: {
            x: this.timeAxis(domain),
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(132,147,151,0.1)' },
              ticks: { ...axisTicks(), precision: 0 },
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

      const domain = this.timeDomain();
      this._chart = new Chart(canvas, {
        type: 'scatter',
        plugins: [nowMarker],
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
            nowMarker: { at: domain.now },
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
            x: this.timeAxis(domain),
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(132,147,151,0.1)' },
              ticks: { ...axisTicks(), callback: (value) => formatDuration(value) },
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

    // Both charts answer "when did this happen", so they get one domain. Computing it per chart
    // gave each its own `now`, which is two axes that almost line up — the thing this replaced.
    timeDomain() {
      if (this._domain && this._domain.stats === this.stats) return this._domain.value;

      const now = Date.now();
      const from = this.stats?.window?.from ? Date.parse(this.stats.window.from) : now - 3600000;
      const span = Math.max(now - from, 60000);
      const value = { min: from, max: now + span * 0.03, now };

      this._domain = { stats: this.stats, value };
      return value;
    },

    timeAxis(domain) {
      const multiDay = domain.max - domain.min > 36 * 3600000;
      return {
        type: 'linear',
        min: domain.min,
        max: domain.max,
        grid: { color: 'rgba(132,147,151,0.1)' },
        ticks: {
          ...axisTicks(),
          maxTicksLimit: 7,
          autoSkip: true,
          callback: (value) => (multiDay ? formatDayHour(value) : formatHourMinute(value)),
        },
      };
    },

    // Above the cap the scatter and the totals stop describing the same rows, so the chart says so
    // rather than letting a partial picture read as the whole window.
    scatterCaption() {
      const shown = this.stats?.recent_requests?.length || 0;
      const total = this.stats?.recent_requests_total || 0;
      return total > shown ? `last ${shown} of ${total.toLocaleString()}` : '';
    },

    // A rate with nothing to compare it against is a number, not a reading. The two quota windows
    // are already measured, so the short one is judged against the long one rather than a guess.
    burnVerdict(w) {
      const windows = this.stats?.quota?.windows || [];
      const week = windows.find((x) => x.hours >= 24);
      if (!week || w === week || !week.cost_per_hour || !w.cost_per_hour) return '';

      const ratio = w.cost_per_hour / week.cost_per_hour;
      if (ratio >= 2) return `${ratio.toFixed(1)}× the weekly pace`;
      if (ratio <= 0.5) return `${(1 / ratio).toFixed(1)}× slower than the week`;
      return 'in line with the week';
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
    formatRelative,
  };
}

function overviewPage() {
  return {
    stats: null,
    period: '24h',
    loading: true,

    async init() {
      await this.fetchStats();
    },

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

    renderOverview() {
      const h = this.$data.$root ? this.$data.$root.health : (window._health || {});
      const health = this.$root?.health || h || {};
      const s = this.stats;

      let html = '';

      // Provider cards
      html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">';
      const providers = health.providers || {};
      for (const [name, info] of Object.entries(providers)) {
        const ok = info.installed && info.authenticated;
        const dotClass = ok ? 'dot-green' : (info.installed ? 'dot-red' : 'dot-gray');
        const statusText = ok ? 'Ready' : (info.installed ? 'Not authenticated' : 'Not installed');
        html += `
          <div class="bg-white rounded-lg shadow p-4">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2.5 h-2.5 rounded-full ${dotClass} inline-block"></span>
              <span class="font-medium text-gray-800">${escapeHtml(name)}</span>
            </div>
            <p class="text-xs text-gray-500">${escapeHtml(statusText)}</p>
          </div>`;
      }
      // Queue card
      const q = health.queue || {};
      html += `
        <div class="bg-white rounded-lg shadow p-4">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium text-gray-800">Queue</span>
          </div>
          <p class="text-xs text-gray-500">Active: ${q.active ?? 0} / ${q.max_concurrent ?? 0} &middot; Pending: ${q.pending ?? 0}</p>
        </div>`;
      html += '</div>';

      // Period selector + stats
      if (s) {
        html += '<div class="flex items-center gap-2 mb-4">';
        for (const p of ['24h', '7d', '30d']) {
          const active = this.period === p;
          html += `<button onclick="document.querySelector('[x-data=\\'overviewPage()\\']').__x.$data.changePeriod('${p}')"
            class="px-3 py-1 rounded text-sm ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border'}">${p}</button>`;
        }
        html += '</div>';

        html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">';
        html += this.statCard('Requests', s.total_requests);
        html += this.statCard('Tokens', s.total_tokens?.toLocaleString() || '0');
        html += this.statCard('Cost', formatCost(s.total_cost_usd));
        html += this.statCard('Avg Duration', formatDuration(s.avg_duration_ms));
        html += '</div>';

        // By provider
        if (Object.keys(s.by_provider || {}).length > 0) {
          html += '<div class="bg-white rounded-lg shadow p-4 mb-4">';
          html += '<h3 class="text-sm font-medium text-gray-600 mb-2">Requests by Provider</h3>';
          html += '<div class="space-y-1">';
          for (const [prov, count] of Object.entries(s.by_provider)) {
            const pct = s.total_requests > 0 ? Math.round((count / s.total_requests) * 100) : 0;
            html += `<div class="flex items-center gap-2">
              <span class="text-sm text-gray-700 w-20">${escapeHtml(prov)}</span>
              <div class="flex-1 bg-gray-100 rounded h-4">
                <div class="bg-blue-500 rounded h-4" style="width: ${pct}%"></div>
              </div>
              <span class="text-sm text-gray-500 w-12 text-right">${count}</span>
            </div>`;
          }
          html += '</div></div>';
        }

        // Active clients
        html += `<div class="bg-white rounded-lg shadow p-4">
          <h3 class="text-sm font-medium text-gray-600 mb-1">Active Clients</h3>
          <p class="text-2xl font-bold text-gray-800">${s.active_clients}</p>
        </div>`;
      } else if (this.loading) {
        html += '<p class="text-gray-500">Loading stats...</p>';
      }

      return html;
    },

    statCard(label, value) {
      return `<div class="bg-white rounded-lg shadow p-4">
        <p class="text-xs text-gray-500 uppercase tracking-wide">${escapeHtml(label)}</p>
        <p class="text-2xl font-bold text-gray-800 mt-1">${escapeHtml(String(value))}</p>
      </div>`;
    },
  };
}

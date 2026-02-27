function logsPage() {
  return {
    logs: [],
    total: 0,
    limit: 50,
    offset: 0,
    filterProvider: '',
    filterStatus: '',
    loading: true,

    async init() {
      await this.fetchLogs();
    },

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

    renderLogs() {
      let html = '';

      // Filters
      html += `<div class="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label class="block text-xs text-gray-500 mb-1">Provider</label>
          <select onchange="this.closest('[x-data]').__x.$data.filterProvider = this.value; this.closest('[x-data]').__x.$data.applyFilters()"
            class="border rounded px-2 py-1.5 text-sm bg-white">
            <option value="">All</option>
            <option value="claude" ${this.filterProvider === 'claude' ? 'selected' : ''}>claude</option>
            <option value="gemini" ${this.filterProvider === 'gemini' ? 'selected' : ''}>gemini</option>
            <option value="codex" ${this.filterProvider === 'codex' ? 'selected' : ''}>codex</option>
            <option value="cerebras" ${this.filterProvider === 'cerebras' ? 'selected' : ''}>cerebras</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Status</label>
          <select onchange="this.closest('[x-data]').__x.$data.filterStatus = this.value; this.closest('[x-data]').__x.$data.applyFilters()"
            class="border rounded px-2 py-1.5 text-sm bg-white">
            <option value="">All</option>
            <option value="2" ${this.filterStatus === '2' ? 'selected' : ''}>2xx</option>
            <option value="4" ${this.filterStatus === '4' ? 'selected' : ''}>4xx</option>
            <option value="5" ${this.filterStatus === '5' ? 'selected' : ''}>5xx</option>
          </select>
        </div>
        <div class="text-sm text-gray-500 self-end pb-1">${this.total} total</div>
      </div>`;

      // Table
      html += `<div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th class="px-3 py-2 text-left">Time</th>
              <th class="px-3 py-2 text-left">Status</th>
              <th class="px-3 py-2 text-left">Client</th>
              <th class="px-3 py-2 text-left">Provider</th>
              <th class="px-3 py-2 text-left">Model</th>
              <th class="px-3 py-2 text-right">Duration</th>
              <th class="px-3 py-2 text-right">Tokens</th>
              <th class="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">`;

      if (this.logs.length === 0) {
        html += `<tr><td colspan="8" class="px-3 py-8 text-center text-gray-400">${this.loading ? 'Loading...' : 'No logs found'}</td></tr>`;
      }

      for (const log of this.logs) {
        const badge = statusBadgeClass(log.status);
        html += `<tr class="hover:bg-gray-50">
          <td class="px-3 py-2 text-gray-500 whitespace-nowrap">${formatTime(log.created_at)}</td>
          <td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs font-medium ${badge}">${log.status}</span></td>
          <td class="px-3 py-2 text-gray-700">${escapeHtml(log.client_name) || '<span class="text-gray-300">-</span>'}</td>
          <td class="px-3 py-2 text-gray-700">${escapeHtml(log.provider) || '-'}</td>
          <td class="px-3 py-2 text-gray-700">${escapeHtml(log.model) || '-'}</td>
          <td class="px-3 py-2 text-right text-gray-600">${formatDuration(log.duration_ms)}</td>
          <td class="px-3 py-2 text-right text-gray-600">${log.tokens != null ? log.tokens.toLocaleString() : '-'}</td>
          <td class="px-3 py-2 text-right text-gray-600">${formatCost(log.cost_usd)}</td>
        </tr>`;
      }

      html += '</tbody></table></div>';

      // Pagination
      html += `<div class="flex items-center justify-between mt-4">
        <button onclick="this.closest('[x-data]').__x.$data.prevPage()"
          class="px-3 py-1.5 rounded text-sm border ${this.offset <= 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}"
          ${this.offset <= 0 ? 'disabled' : ''}>Previous</button>
        <span class="text-sm text-gray-500">Page ${this.currentPage} of ${this.totalPages}</span>
        <button onclick="this.closest('[x-data]').__x.$data.nextPage()"
          class="px-3 py-1.5 rounded text-sm border ${this.offset + this.limit >= this.total ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}"
          ${this.offset + this.limit >= this.total ? 'disabled' : ''}>Next</button>
      </div>`;

      return html;
    },
  };
}

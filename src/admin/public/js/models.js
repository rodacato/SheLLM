function modelsPage() {
  return {
    models: [],
    loading: true,

    async init() {
      await this.fetchModels();
    },

    async fetchModels() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/models`);
        if (res.ok) {
          const data = await res.json();
          this.models = data.data || [];
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    renderModels() {
      const health = this.$root?.health || {};
      const providers = health.providers || {};
      let html = '';

      // Provider cards
      html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">';
      for (const [name, info] of Object.entries(providers)) {
        const ok = info.installed && info.authenticated;
        const dotClass = ok ? 'dot-green' : (info.installed ? 'dot-red' : 'dot-gray');
        const statusText = ok ? 'Authenticated' : (info.installed ? (info.error || 'Not authenticated') : 'Not installed');

        // Find models for this provider
        const providerModels = this.models.filter((m) => m.id.startsWith(name) || m.id === name);

        html += `<div class="bg-white rounded-lg shadow p-5">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-3 h-3 rounded-full ${dotClass} inline-block"></span>
            <h3 class="text-lg font-semibold text-gray-800">${escapeHtml(name)}</h3>
          </div>
          <p class="text-sm text-gray-500 mb-3">${escapeHtml(statusText)}</p>`;

        if (providerModels.length > 0) {
          html += '<div class="flex flex-wrap gap-1.5">';
          for (const m of providerModels) {
            html += `<span class="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono">${escapeHtml(m.id)}</span>`;
          }
          html += '</div>';
        }

        html += '</div>';
      }
      html += '</div>';

      // All models table
      html += `<div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th class="px-3 py-2 text-left">Model ID</th>
              <th class="px-3 py-2 text-left">Owned By</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">`;

      if (this.loading && this.models.length === 0) {
        html += '<tr><td colspan="2" class="px-3 py-8 text-center text-gray-400">Loading...</td></tr>';
      }

      for (const model of this.models) {
        html += `<tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-mono text-gray-800">${escapeHtml(model.id)}</td>
          <td class="px-3 py-2 text-gray-500">${escapeHtml(model.owned_by)}</td>
        </tr>`;
      }

      html += '</tbody></table></div>';
      return html;
    },
  };
}

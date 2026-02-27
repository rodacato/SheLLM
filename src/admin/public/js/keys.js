function keysPage() {
  return {
    keys: [],
    loading: true,
    showCreateModal: false,
    newKeyResult: null,
    createForm: { name: '', rpm: 10, models: '' },

    async init() {
      await this.fetchKeys();
    },

    async fetchKeys() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/keys`);
        if (res.ok) {
          const data = await res.json();
          this.keys = data.keys;
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    async createKey() {
      const body = {
        name: this.createForm.name.trim(),
        rpm: parseInt(this.createForm.rpm, 10) || 10,
      };
      if (this.createForm.models.trim()) {
        body.models = this.createForm.models.split(',').map((m) => m.trim()).filter(Boolean);
      }

      try {
        const res = await apiFetch(`${API_BASE}/keys`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          this.newKeyResult = data.key;
          this.createForm = { name: '', rpm: 10, models: '' };
          await this.fetchKeys();
        } else {
          const err = await res.json();
          alert(err.message || 'Failed to create key');
        }
      } catch { alert('Network error'); }
    },

    async toggleActive(key) {
      const newActive = key.active ? 0 : 1;
      try {
        await apiFetch(`${API_BASE}/keys/${key.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: newActive }),
        });
        await this.fetchKeys();
      } catch { /* ignore */ }
    },

    async rotateKey(key) {
      if (!confirm(`Rotate key for "${key.name}"? The old key will stop working immediately.`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/keys/${key.id}/rotate`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          this.newKeyResult = { ...data.key, name: key.name };
          await this.fetchKeys();
        }
      } catch { /* ignore */ }
    },

    async deleteKey(key) {
      if (!confirm(`Delete key "${key.name}"? This cannot be undone.`)) return;
      try {
        await apiFetch(`${API_BASE}/keys/${key.id}`, { method: 'DELETE' });
        await this.fetchKeys();
      } catch { /* ignore */ }
    },

    closeNewKeyResult() {
      this.newKeyResult = null;
    },

    renderKeys() {
      let html = '';

      // New key result banner
      if (this.newKeyResult) {
        html += `<div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-sm font-medium text-green-800">Key ${this.newKeyResult.raw_key ? 'created' : 'rotated'} for "${escapeHtml(this.newKeyResult.name)}"</p>
              <p class="text-xs text-green-600 mt-1">Copy this key now — it won't be shown again.</p>
              <code class="block mt-2 bg-white border rounded px-3 py-2 text-sm font-mono select-all">${escapeHtml(this.newKeyResult.raw_key)}</code>
            </div>
            <button onclick="this.closest('[x-data]').__x.$data.closeNewKeyResult()"
              class="text-green-400 hover:text-green-600 text-lg">&times;</button>
          </div>
        </div>`;
      }

      // Create button
      html += `<div class="mb-4">
        <button onclick="this.closest('[x-data]').__x.$data.showCreateModal = true"
          class="btn-brand px-4 py-2 rounded text-sm">Create Key</button>
      </div>`;

      // Keys table
      html += `<div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th class="px-3 py-2 text-left">Name</th>
              <th class="px-3 py-2 text-left">Key Prefix</th>
              <th class="px-3 py-2 text-center">RPM</th>
              <th class="px-3 py-2 text-left">Models</th>
              <th class="px-3 py-2 text-center">Status</th>
              <th class="px-3 py-2 text-left">Created</th>
              <th class="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">`;

      if (this.keys.length === 0) {
        html += `<tr><td colspan="7" class="px-3 py-8 text-center text-gray-400">${this.loading ? 'Loading...' : 'No keys created yet'}</td></tr>`;
      }

      for (const key of this.keys) {
        const activeClass = key.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500';
        const activeLabel = key.active ? 'Active' : 'Inactive';
        const models = key.models ? key.models.join(', ') : 'All';
        html += `<tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-medium text-gray-800">${escapeHtml(key.name)}</td>
          <td class="px-3 py-2 font-mono text-gray-500 text-xs">${escapeHtml(key.key_prefix)}...</td>
          <td class="px-3 py-2 text-center">${key.rpm}</td>
          <td class="px-3 py-2 text-gray-600 text-xs">${escapeHtml(models)}</td>
          <td class="px-3 py-2 text-center">
            <button onclick="this.closest('[x-data]').__x.$data.toggleActive(${JSON.stringify(key).replace(/"/g, '&quot;')})"
              class="px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${activeClass}">${activeLabel}</button>
          </td>
          <td class="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">${formatTime(key.created_at)}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap">
            <button onclick="this.closest('[x-data]').__x.$data.rotateKey(${JSON.stringify(key).replace(/"/g, '&quot;')})"
              class="link-brand text-xs mr-2">Rotate</button>
            <button onclick="this.closest('[x-data]').__x.$data.deleteKey(${JSON.stringify(key).replace(/"/g, '&quot;')})"
              class="text-red-600 hover:text-red-800 text-xs">Delete</button>
          </td>
        </tr>`;
      }

      html += '</tbody></table></div>';
      return html;
    },
  };
}

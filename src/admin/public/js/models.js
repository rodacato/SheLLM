function modelsPage() {
  return {
    models: [],
    providers: [],
    loading: true,
    addingModelProvider: null,
    newModelName: '',
    newModelUpstream: '',
    addingProvider: false,
    newProvider: { name: '', chat_url: '', auth_env: '' },
    providerTemplates: [
      { label: 'Custom', name: '', chat_url: '', auth_env: '' },
      { label: 'Cerebras', name: 'cerebras', chat_url: 'https://api.cerebras.ai/v1/chat/completions', auth_env: 'CEREBRAS_API_KEY' },
      { label: 'Groq', name: 'groq', chat_url: 'https://api.groq.com/openai/v1/chat/completions', auth_env: 'GROQ_API_KEY' },
      { label: 'OpenRouter', name: 'openrouter', chat_url: 'https://openrouter.ai/api/v1/chat/completions', auth_env: 'OPENROUTER_API_KEY' },
      { label: 'Together', name: 'together', chat_url: 'https://api.together.xyz/v1/chat/completions', auth_env: 'TOGETHER_API_KEY' },
      { label: 'Fireworks', name: 'fireworks', chat_url: 'https://api.fireworks.ai/inference/v1/chat/completions', auth_env: 'FIREWORKS_API_KEY' },
    ],

    async fetchModels() {
      this.loading = true;
      try {
        // Fetch providers (includes models, type, capabilities, health)
        const provRes = await apiFetch(`${API_BASE}/providers`);
        if (provRes.ok) {
          const data = await provRes.json();
          this.providers = data.providers || [];
          // Flatten all models with provider info
          this.models = [];
          for (const prov of this.providers) {
            for (const m of prov.models || []) {
              this.models.push({
                id: m.name,
                provider: prov.name,
                upstream_model: m.upstream_model,
                is_alias: m.is_alias,
                authenticated: prov.authenticated,
                installed: prov.installed,
                enabled: prov.enabled,
              });
            }
          }
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    get cliProviders() {
      return this.providers.filter((p) => p.type === 'subprocess');
    },

    get httpProviders() {
      return this.providers.filter((p) => p.type === 'http');
    },

    providerStatus(providerName) {
      return this.providers.find((p) => p.name === providerName) || null;
    },

    async toggleProvider(name, enable) {
      const action = enable ? 'Enable' : 'Disable';
      if (!confirm(`${action} provider "${name}"? ${enable ? 'It will start receiving requests.' : 'Active requests to this provider will fail.'}`)) return;
      try {
        await apiFetch(`${API_BASE}/providers/${name}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: enable ? 1 : 0 }),
        });
        await this.fetchModels();
        if (this.$root?.fetchHealth) await this.$root.fetchHealth();
      } catch { /* ignore */ }
    },

    // --- Model CRUD ---

    startAddModel(providerName) {
      this.addingModelProvider = providerName;
      this.newModelName = '';
      this.newModelUpstream = '';
      this.$nextTick(() => {
        const input = this.$el.querySelector(`input[placeholder="model-name"]`);
        if (input) input.focus();
      });
    },

    cancelAddModel() {
      this.addingModelProvider = null;
      this.newModelName = '';
      this.newModelUpstream = '';
    },

    async addModel(providerName) {
      const name = this.newModelName.trim();
      if (!name) return;
      try {
        const body = { name };
        const upstream = this.newModelUpstream.trim();
        if (upstream) body.upstream_model = upstream;
        await apiFetch(`${API_BASE}/providers/${providerName}/models`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        this.cancelAddModel();
        await this.fetchModels();
      } catch { /* ignore */ }
    },

    async removeModel(providerName, modelName) {
      if (!confirm(`Remove model "${modelName}" from ${providerName}?`)) return;
      try {
        await apiFetch(`${API_BASE}/providers/${providerName}/models/${modelName}`, {
          method: 'DELETE',
        });
        await this.fetchModels();
      } catch { /* ignore */ }
    },

    // --- Provider CRUD ---

    startAddProvider() {
      this.addingProvider = true;
      this.newProvider = { name: '', chat_url: '', auth_env: '' };
    },

    applyTemplate(tpl) {
      this.newProvider.name = tpl.name;
      this.newProvider.chat_url = tpl.chat_url;
      this.newProvider.auth_env = tpl.auth_env;
    },

    cancelAddProvider() {
      this.addingProvider = false;
      this.newProvider = { name: '', chat_url: '', auth_env: '' };
    },

    async createProvider() {
      const { name, chat_url, auth_env } = this.newProvider;
      if (!name.trim() || !chat_url.trim()) return;
      try {
        const res = await apiFetch(`${API_BASE}/providers`, {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), chat_url: chat_url.trim(), auth_env: auth_env.trim() || undefined }),
        });
        if (res.ok) {
          this.cancelAddProvider();
          await this.fetchModels();
          if (this.$root?.fetchHealth) await this.$root.fetchHealth();
        }
      } catch { /* ignore */ }
    },

    async deleteProvider(name) {
      if (!confirm(`Delete provider "${name}" and all its models? This cannot be undone.`)) return;
      try {
        await apiFetch(`${API_BASE}/providers/${name}`, { method: 'DELETE' });
        await this.fetchModels();
        if (this.$root?.fetchHealth) await this.$root.fetchHealth();
      } catch { /* ignore */ }
    },
  };
}

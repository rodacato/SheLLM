function playgroundPage() {
  return {
    // State
    providers: [],
    models: [],
    apiKey: '',
    selectedProvider: '',
    selectedModel: '',
    systemPrompt: '',
    userPrompt: '',
    streaming: true,
    sending: false,

    // Response
    response: null,    // { status, statusText, latency, requestId, tokens, content, error, contentType }
    streamContent: '',
    streamActive: false,
    elapsedMs: 0,
    _timerInterval: null,
    _abortController: null,

    async init() {
      await Promise.all([this.fetchProviders(), this.fetchModels()]);
      if (this.providers.length > 0 && !this.selectedProvider) {
        this.selectedProvider = this.providers[0].name;
        this.filterModels();
      }
    },

    async fetchProviders() {
      try {
        const res = await apiFetch(`${API_BASE}/providers`);
        if (res.ok) {
          const data = await res.json();
          this.providers = data.providers || [];
        }
      } catch { /* ignore */ }
    },

    async fetchModels() {
      try {
        const res = await apiFetch(`${API_BASE}/models`);
        if (res.ok) {
          const data = await res.json();
          this.models = data.data || [];
        }
      } catch { /* ignore */ }
    },


    get filteredModels() {
      if (!this.selectedProvider) return this.models;
      const prov = this.providers.find(p => p.name === this.selectedProvider);
      if (!prov || !prov.models) return this.models;
      return prov.models.map(id => ({ id }));
    },

    filterModels() {
      const filtered = this.filteredModels;
      if (filtered.length > 0 && !filtered.find(m => m.id === this.selectedModel)) {
        this.selectedModel = filtered[0].id;
      }
    },

    onProviderChange() {
      this.filterModels();
    },

    get needsKey() {
      return !this.apiKey.trim();
    },

    buildHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey.trim()) headers['Authorization'] = `Bearer ${this.apiKey.trim()}`;
      return headers;
    },

    buildBody() {
      const messages = [];
      if (this.systemPrompt.trim()) {
        messages.push({ role: 'system', content: this.systemPrompt.trim() });
      }
      messages.push({ role: 'user', content: this.userPrompt.trim() });

      const body = {
        model: this.selectedModel || this.selectedProvider,
        messages,
      };
      if (this.streaming) body.stream = true;
      return body;
    },

    startTimer() {
      this.elapsedMs = 0;
      const t0 = Date.now();
      this._timerInterval = setInterval(() => { this.elapsedMs = Date.now() - t0; }, 100);
    },

    stopTimer() {
      if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
    },

    get elapsedDisplay() {
      if (!this.sending && !this.streamActive) return null;
      const s = (this.elapsedMs / 1000).toFixed(1);
      return `${s}s`;
    },

    async send() {
      if (!this.userPrompt.trim() || this.sending || this.needsKey) return;

      this.sending = true;
      this.response = null;
      this.streamContent = '';
      this.streamActive = false;
      this._abortController = new AbortController();
      this.startTimer();

      const body = this.buildBody();
      const headers = this.buildHeaders();
      const startTime = Date.now();

      try {
        if (this.streaming) {
          await this.sendStream(body, headers, startTime);
        } else {
          await this.sendSync(body, headers, startTime);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.response = {
            status: 0,
            statusText: 'Network Error',
            latency: Date.now() - startTime,
            content: '',
            error: err.message,
          };
        }
      }
      this._abortController = null;
      this.stopTimer();
      this.sending = false;
    },

    cancelRequest() {
      if (this._abortController) {
        this._abortController.abort();
        this.streamActive = false;
      }
    },

    async sendSync(body, headers, startTime) {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: this._abortController?.signal,
      });

      const latency = Date.now() - startTime;
      const data = await res.json();

      this.response = {
        status: res.status,
        statusText: res.statusText,
        latency,
        requestId: data.id || null,
        tokens: data.usage?.total_tokens || null,
        content: data.choices?.[0]?.message?.content || '',
        error: data.error?.message || null,
        contentType: res.headers.get('content-type'),
      };
    },

    async sendStream(body, headers, startTime) {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: this._abortController?.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.response = {
          status: res.status,
          statusText: res.statusText,
          latency: Date.now() - startTime,
          content: '',
          error: data.error?.message || `HTTP ${res.status}`,
        };
        return;
      }

      this.streamActive = true;
      this.response = {
        status: res.status,
        statusText: res.statusText,
        latency: null,
        requestId: null,
        tokens: null,
        content: '',
        error: null,
        contentType: res.headers.get('content-type'),
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') {
            this.streamActive = false;
            continue;
          }
          try {
            const chunk = JSON.parse(payload);
            if (firstChunk) {
              this.response.requestId = chunk.id || null;
              this.response.latency = Date.now() - startTime;
              firstChunk = false;
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              this.streamContent += delta;
              this.response.content = this.streamContent;
            }
          } catch { /* skip */ }
        }
      }
      this.streamActive = false;
    },

    clearResponse() {
      this.response = null;
      this.streamContent = '';
      this.streamActive = false;
    },

    copyResponse() {
      if (this.response?.content) {
        navigator.clipboard.writeText(this.response.content);
      }
    },

    copyCurl() {
      const body = this.buildBody();
      const parts = ['curl -s'];
      if (this.apiKey.trim()) parts.push(`-H 'Authorization: Bearer ${this.apiKey.trim()}'`);
      parts.push("-H 'Content-Type: application/json'");
      parts.push(`-d '${JSON.stringify(body)}'`);
      parts.push(`'${location.origin}/v1/chat/completions'`);
      navigator.clipboard.writeText(parts.join(' \\\n  '));
    },

    get statusClass() {
      if (!this.response) return '';
      if (this.response.status >= 200 && this.response.status < 300) return 'text-[#00e639]';
      if (this.response.status >= 400 && this.response.status < 500) return 'text-error';
      return 'text-error';
    },

    get statusDot() {
      if (!this.response) return '';
      if (this.response.status >= 200 && this.response.status < 300) return 'bg-[#00e639]';
      return 'bg-error';
    },

    formatTime,
    formatDuration,
    formatCost,
  };
}

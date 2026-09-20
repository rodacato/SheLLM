// The playground calls /v1 exactly as an application does: same key, same rate limit, same log
// row. An admin-only shortcut would exercise a path no application uses, and would reach the CLI
// without passing the key system.
const PLAYGROUND_KEY_STORAGE = 'shellm_playground_key';

function playgroundPage() {
  return {
    apiKey: '',
    rememberKey: false,
    format: 'openai',
    model: 'claude',
    prompt: 'Reply with one short sentence.',
    models: [],
    catalogs: [],
    running: false,
    result: null,
    error: null,
    showRaw: false,
    _abort: null,

    initPlayground() {
      try {
        const stored = sessionStorage.getItem(PLAYGROUND_KEY_STORAGE);
        if (stored) {
          this.apiKey = stored;
          this.rememberKey = true;
        }
      } catch { /* private mode, or storage refused */ }
      this.fetchModels();
    },

    async fetchModels() {
      try {
        const res = await apiFetch(`${API_BASE}/providers`);
        if (!res.ok) return;
        const { providers } = await res.json();
        const enabled = providers.filter((p) => p.enabled);
        this.catalogs = enabled.map((p) => ({ provider: p.name, running: p.version, ...(p.catalog || {}) }));
        this.models = this.catalogs.flatMap((c) => c.models || []);
        if (this.models.length > 0 && !this.models.some((m) => m.id === this.model)) {
          this.model = (this.models.find((m) => m.isDefault) || this.models[0]).id;
        }
      } catch { /* the list is a convenience; the field still accepts anything */ }
    },

    // Where the names came from, per provider. A list that cannot say it is stale is the same
    // defect as a table that renders a failed read as an empty one.
    get catalogNotes() {
      return this.catalogs.map((c) => {
        if (c.source === 'cli') return `${c.provider}: asked the CLI`;
        if (c.source === 'baked') {
          const drift = c.cli && c.running && c.cli !== c.running ? `, this host runs ${c.running}` : '';
          return `${c.provider}: built ${c.generatedAt} against CLI ${c.cli}${drift}`;
        }
        return `${c.provider}: could not ask — built-in aliases only`;
      });
    },

    get retiring() {
      return this.models.filter((m) => m.retiresAt);
    },

    get endpoint() {
      return this.format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    },

    requestBody() {
      const messages = [{ role: 'user', content: this.prompt }];
      return this.format === 'anthropic'
        ? { model: this.model, max_tokens: 1024, messages }
        : { model: this.model, messages };
    },

    answerText(body) {
      if (!body) return '';
      if (this.format === 'anthropic') {
        return (body.content || []).map((part) => part.text || '').join('').trim();
      }
      return body.choices?.[0]?.message?.content?.trim() || '';
    },

    usageOf(body) {
      const usage = body?.usage;
      if (!usage) return null;
      return this.format === 'anthropic'
        ? { input: usage.input_tokens, output: usage.output_tokens }
        : { input: usage.prompt_tokens, output: usage.completion_tokens };
    },

    async send() {
      if (!this.apiKey.trim()) {
        this.error = 'A client key is required — the playground authenticates like any other caller.';
        return;
      }
      this.running = true;
      this.error = null;
      this.result = null;
      this.storeKey();

      // Without this a hung CLI left "Waiting for the CLI…" on screen forever with the Send
      // button disabled, and the only way out was a page reload.
      this._abort = new AbortController();

      const started = performance.now();
      try {
        // Deliberately not apiFetch: a 401 here means the client key was refused, and apiFetch
        // would read it as an expired admin session and navigate away mid-request.
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey.trim()}`,
          },
          body: JSON.stringify(this.requestBody()),
          signal: this._abort.signal,
        });
        const elapsed = Math.round(performance.now() - started);
        const body = await res.json().catch(() => null);

        this.result = {
          status: res.status,
          ok: res.ok,
          elapsed_ms: elapsed,
          request_id: res.headers.get('x-request-id'),
          answer: res.ok ? this.answerText(body) : '',
          usage: res.ok ? this.usageOf(body) : null,
          body,
        };
      } catch (err) {
        this.error = err?.name === 'AbortError'
          ? 'Stopped waiting. The request is still running on the server and will appear in the logs — giving up here does not stop the CLI.'
          : 'The request never completed — is the server still running?';
      }
      this._abort = null;
      this.running = false;
    },

    stopWaiting() {
      if (this._abort) this._abort.abort();
    },

    storeKey() {
      try {
        if (this.rememberKey) sessionStorage.setItem(PLAYGROUND_KEY_STORAGE, this.apiKey.trim());
        else sessionStorage.removeItem(PLAYGROUND_KEY_STORAGE);
      } catch { /* nothing to do if storage is unavailable */ }
    },

    forgetKey() {
      this.apiKey = '';
      this.rememberKey = false;
      this.storeKey();
    },

    errorMessage(body) {
      if (!body) return 'no response body';
      return body.error?.message || body.message || JSON.stringify(body);
    },

    formatDuration,
  };
}

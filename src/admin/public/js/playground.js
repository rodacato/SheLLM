// The playground calls /v1 exactly as an application does: same key, same rate limit, same log
// row. An admin-only shortcut would exercise a path no application uses, and would reach the CLI
// without passing the key system.
const PLAYGROUND_KEY_STORAGE = 'shellm_playground_key';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Claude scales anything past this long edge down anyway, so sending more only costs upload time.
const IMAGE_LONG_EDGE = 1568;
const IMAGE_KEEP_BYTES = 1024 * 1024;

// A photo that already fits is sent untouched, keeping its type; anything larger is re-encoded.
function imagePlan(width, height, bytes) {
  const scale = Math.min(1, IMAGE_LONG_EDGE / Math.max(width, height));
  if (scale === 1 && bytes <= IMAGE_KEEP_BYTES) return { reencode: false, width, height };
  return { reencode: true, width: Math.round(width * scale), height: Math.round(height * scale) };
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const plan = imagePlan(bitmap.width, bitmap.height, file.size);
  let blob = file;
  if (plan.reencode) {
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, plan.width, plan.height);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }
  bitmap.close();
  return {
    name: file.name,
    originalBytes: file.size,
    bytes: blob.size,
    width: plan.width,
    height: plan.height,
    resized: plan.reencode,
    dataUrl: await readAsDataUrl(blob),
  };
}

function playgroundPage() {
  return {
    apiKey: '',
    rememberKey: false,
    format: 'openai',
    model: 'claude',
    prompt: 'Reply with one short sentence.',
    images: [],
    imageError: null,
    _imageSeq: 0,
    models: [],
    catalogs: [],
    running: false,
    result: null,
    error: null,
    showRaw: false,
    catalogsError: null,
    catalogsLoaded: false,
    waitingMs: 0,
    _abort: null,
    _ticker: null,

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
        if (!res.ok) throw new Error(`the gateway answered ${res.status}`);
        const { providers } = await res.json();
        const enabled = providers.filter((p) => p.enabled);
        this.catalogs = enabled.map((p) => ({ provider: p.name, running: p.version, ...(p.catalog || {}) }));
        this.models = this.catalogs.flatMap((c) => c.models || []);
        if (this.models.length > 0 && !this.models.some((m) => m.id === this.model)) {
          this.model = (this.models.find((m) => m.isDefault) || this.models[0]).id;
        }
        this.catalogsError = null;
      } catch (err) {
        this.catalogsError = err.message;
      }
      this.catalogsLoaded = true;
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

    // Only /v1/chat/completions takes images; /v1/messages is text-only.
    get imagesSupported() {
      return this.format === 'openai';
    },

    async addImages(files) {
      this.imageError = null;
      for (const file of Array.from(files || [])) {
        if (!IMAGE_TYPES.includes(file.type)) {
          this.imageError = `${file.name} is not JPEG, PNG, WebP or GIF.`;
          continue;
        }
        try {
          this.images.push({ ...(await prepareImage(file)), id: ++this._imageSeq });
        } catch {
          this.imageError = `${file.name} could not be read as an image.`;
        }
      }
    },

    removeImage(index) {
      this.images.splice(index, 1);
    },

    userContent() {
      if (!this.imagesSupported || this.images.length === 0) return this.prompt;
      return [
        { type: 'text', text: this.prompt },
        ...this.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
      ];
    },

    requestBody() {
      const messages = [{ role: 'user', content: this.userContent() }];
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
      // A dimmed button and a static sentence are also what a hung request looks like, and what
      // a finished-but-unrendered one looks like. The clock is what tells them apart.
      this.waitingMs = 0;
      this._ticker = setInterval(() => { this.waitingMs = Math.round(performance.now() - started); }, 100);
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
      clearInterval(this._ticker);
      this._ticker = null;
      this._abort = null;
      this.running = false;
      this.revealResponse();
    },

    // The form is taller than the fold, so stacked the answer lands below it and pressing Send
    // looked like nothing happened. Guarded because the page's own tests run without a DOM.
    revealResponse() {
      const panel = typeof document !== 'undefined' && document.getElementById
        ? document.getElementById('playground-response')
        : null;
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    },
  };
}

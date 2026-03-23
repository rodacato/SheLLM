function livePage() {
  return {
    logs: [],
    connected: false,
    paused: false,
    filterText: '',
    filterLevels: { debug: true, info: true, warn: true, error: true },
    _reader: null,
    _abortController: null,

    async connect() {
      if (this.connected) return;
      this.paused = false;
      this._abortController = new AbortController();

      try {
        const res = await fetch(`${API_BASE}/logs/stream`, {
          signal: this._abortController.signal,
        });
        if (!res.ok) return;

        this.connected = true;
        this._reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await this._reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const msg = JSON.parse(payload);
              if (msg.type === 'batch' && msg.logs) {
                this.logs = [...this.logs, ...msg.logs].slice(-50);
              }
            } catch { /* skip */ }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Terminal stream error:', err.message);
        }
      }
      this.connected = false;
      this._reader = null;
    },

    disconnect() {
      this.paused = true;
      if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
      }
      this.connected = false;
    },

    toggleConnection() {
      if (this.connected) {
        this.disconnect();
      } else {
        this.connect();
      }
    },

    toggleLevel(level) {
      this.filterLevels[level] = !this.filterLevels[level];
    },

    get filteredLogs() {
      const search = this.filterText.toLowerCase();
      return this.logs.filter(log => {
        if (!this.filterLevels[log.level]) return false;
        if (search && !this.formatLogMessage(log).toLowerCase().includes(search)) return false;
        return true;
      });
    },

    levelColor(level) {
      if (level === 'error') return 'text-error font-bold';
      if (level === 'warn') return 'text-[#ffb800] font-bold';
      if (level === 'debug') return 'text-outline';
      return 'text-[#22c55e]';
    },

    formatLogMessage(log) {
      // Known structural keys — everything else is shown as key=value
      const skip = new Set(['ts', 'level', 'event']);
      const parts = [];
      if (log.event) parts.push(log.event);

      // Request events: compact format
      if (log.method) parts.push(`${log.method} ${log.url}`);
      if (log.status) parts.push(String(log.status));
      if (log.duration_ms != null) parts.push(`${log.duration_ms}ms`);
      skip.add('method'); skip.add('url'); skip.add('status'); skip.add('duration_ms');

      // Common fields
      const common = ['provider', 'model', 'client', 'message', 'signal', 'error', 'reason', 'request_id', 'port', 'auth'];
      for (const key of common) {
        if (log[key] != null) parts.push(`${key}=${log[key]}`);
        skip.add(key);
      }

      // Show any remaining unknown fields
      for (const [key, val] of Object.entries(log)) {
        if (skip.has(key) || val == null || typeof val === 'object') continue;
        parts.push(`${key}=${val}`);
      }

      return parts.join(' ') || JSON.stringify(log);
    },

    formatTs(ts) {
      if (!ts) return '--:--:--';
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour12: false });
    },
  };
}

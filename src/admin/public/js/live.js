function livePage() {
  return {
    logs: [],
    connected: false,
    _reader: null,
    _abortController: null,

    async connect() {
      if (this.connected) return;
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
              if (msg.type === 'init') {
                this.logs = msg.logs;
              } else if (msg.type === 'batch') {
                this.logs = [...msg.logs, ...this.logs].slice(0, 50);
              }
            } catch { /* skip */ }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Live stream error:', err.message);
        }
      }
      this.connected = false;
      this._reader = null;
    },

    disconnect() {
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

    statusColor(status) {
      if (status >= 200 && status < 300) return 'text-[#22c55e]';
      if (status >= 400 && status < 500) return 'text-[#ffb800]';
      return 'text-error';
    },

    formatTs(ts) {
      if (!ts) return '--:--:--';
      const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
      return d.toLocaleTimeString('en-US', { hour12: false });
    },

    formatDuration,
  };
}

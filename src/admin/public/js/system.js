function systemPage() {
  return {
    providers: [],
    latestRelease: null,
    releaseError: null,
    loading: true,
    busy: null,

    async load() {
      this.loading = true;
      await Promise.all([this.fetchProviders(), this.fetchLatestRelease()]);
      this.loading = false;
    },

    async fetchProviders() {
      try {
        const res = await apiFetch(`${API_BASE}/providers`);
        if (res.ok) this.providers = (await res.json()).providers;
      } catch { /* ignore */ }
    },

    // Asked of GitHub by the browser, not the server: the service should not need outbound
    // network to report its own state, and an unauthenticated read is rate-limited per viewer.
    async fetchLatestRelease() {
      const repo = this.health?.build?.repository;
      if (!repo) return;
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
        if (res.ok) {
          this.latestRelease = await res.json();
        } else if (res.status === 404) {
          this.releaseError = 'no published releases';
        } else {
          this.releaseError = `GitHub answered ${res.status}`;
        }
      } catch {
        this.releaseError = 'could not reach GitHub';
      }
    },

    get runningVersion() {
      return this.health?.build?.version ?? null;
    },

    get updateAvailable() {
      const latest = this.latestRelease?.tag_name?.replace(/^v/, '');
      const running = this.runningVersion;
      return latest && running && latest !== running ? latest : null;
    },

    async toggleProvider(prov) {
      this.busy = prov.name;
      try {
        const res = await apiFetch(`${API_BASE}/providers/${prov.name}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !prov.enabled }),
        });
        if (res.ok) await this.fetchProviders();
      } catch { /* ignore */ }
      this.busy = null;
    },

    providerState(prov) {
      if (!prov.enabled) return 'paused';
      if (!prov.installed) return 'not installed';
      if (prov.authenticated === false) return 'not authenticated';
      if (prov.authenticated === null) return 'unknown';
      return 'ready';
    },

    formatUptime,
    formatTime,
  };
}

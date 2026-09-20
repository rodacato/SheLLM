// Positive when `tag` is newer than `version`, and 0 when either cannot be read as vX.Y.Z — an
// unreadable tag is never offered as an upgrade rather than being guessed at.
function compareTags(tag, version) {
  const a = String(tag).replace(/^v/, '').split('.').map(Number);
  const b = String(version).replace(/^v/, '').split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((n) => !Number.isInteger(n))) return 0;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

function systemPage() {
  return {
    providers: [],
    latestRelease: null,
    releases: [],
    releaseError: null,
    loading: true,
    busy: null,

    // The update button's own state. `updater` is what the server says about the trigger and the
    // last run; the rest is this page's.
    updater: null,
    target: '',
    confirmText: '',
    updateError: null,
    watching: false,

    get openCircuits() {
      return this.providers.filter((p) => p.circuit && p.circuit.state !== 'closed').map((p) => p.name);
    },

    circuitLabel(prov) {
      const circuit = prov.circuit;
      if (!circuit) return '—';
      if (circuit.state === 'closed') return circuit.failures > 0 ? `closed · ${circuit.failures} recent failures` : 'closed';
      return `${circuit.state} · ${circuit.failures} failures`;
    },

    circuitClass(prov) {
      const state = prov.circuit?.state;
      if (state === 'open') return 'text-[#ef4444] font-bold';
      if (state === 'half-open') return 'text-[#ffb800] font-bold';
      return 'text-on-surface-variant';
    },

    async load() {
      this.loading = true;
      await Promise.all([this.fetchProviders(), this.fetchLatestRelease(), this.fetchUpdater()]);
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
        const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`);
        if (!res.ok) {
          this.releaseError = `GitHub answered ${res.status}`;
          return;
        }
        this.releases = (await res.json()).filter((r) => !r.draft && !r.prerelease);
        this.latestRelease = this.releases[0] ?? null;
        if (!this.latestRelease) this.releaseError = 'no published releases';
        this.target = this.upgradeTargets[0]?.tag_name ?? '';
      } catch {
        this.releaseError = 'could not reach GitHub';
      }
    },

    async fetchUpdater() {
      try {
        const res = await apiFetch(`${API_BASE}/update`);
        if (res.ok) this.updater = await res.json();
      } catch { /* the panel degrades to "unknown" on its own */ }
    },

    // Only releases newer than what runs here. A downgrade is refused by the server anyway —
    // rolling back is done over SSH, where someone is already looking at the host.
    get upgradeTargets() {
      const running = this.runningVersion;
      if (!running) return [];
      return this.releases.filter((r) => compareTags(r.tag_name, running) > 0);
    },

    get selectedRelease() {
      return this.releases.find((r) => r.tag_name === this.target) ?? null;
    },

    get isMajorJump() {
      const running = this.runningVersion;
      if (!this.target || !running) return false;
      return Number(this.target.replace(/^v/, '').split('.')[0]) > Number(running.split('.')[0]);
    },

    get canRequest() {
      if (this.updater?.trigger !== 'ready' || !this.target || this.busy) return false;
      if (this.updater.pending || this.updater.last?.state === 'running') return false;
      return !this.isMajorJump || this.confirmText === this.target;
    },

    // Writes the request and nothing else. What happens next is a root unit's business, and the
    // only thing this page can do is watch the status file the runner leaves behind.
    async requestUpdate() {
      this.busy = 'update';
      this.updateError = null;
      try {
        const res = await apiFetch(`${API_BASE}/update`, {
          method: 'POST',
          body: JSON.stringify({ ref: this.target, confirm: this.confirmText || undefined }),
        });
        if (res.ok) {
          this.confirmText = '';
          this.watchUpdate();
        } else {
          this.updateError = (await res.json().catch(() => ({})))?.error?.message ?? `the server answered ${res.status}`;
        }
      } catch {
        this.updateError = 'could not reach the server';
      }
      this.busy = null;
    },

    // The service is restarted in the middle of what we are watching, so a failed poll is the
    // expected case rather than an error. Stop when the runner reports an end, or give up after
    // the unit's own timeout.
    async watchUpdate() {
      if (this.watching) return;
      this.watching = true;
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        await this.fetchUpdater();
        const last = this.updater?.last;
        if (!this.updater?.pending && last && last.state !== 'running') break;
      }
      this.watching = false;
      await this.fetchLatestRelease();
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

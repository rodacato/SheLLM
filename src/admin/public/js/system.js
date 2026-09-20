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
    providersError: null,
    toggleError: null,
    providersLoaded: false,
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
      if (state === 'open') return 'text-status-fail font-bold';
      if (state === 'half-open') return 'text-status-warn font-bold';
      return 'text-on-surface-variant';
    },

    async load() {
      this.loading = true;
      await Promise.all([this.fetchProviders(), this.fetchLatestRelease(), this.fetchUpdater()]);
      this.loading = false;
    },

    // A swallowed read left the section rendering nothing, which reads as "no providers" on the
    // one page whose job is saying which providers exist.
    async fetchProviders() {
      try {
        this.providers = (await apiRead(`${API_BASE}/providers`)).providers || [];
        this.providersError = null;
      } catch (err) {
        this.providersError = err.message;
      }
      this.providersLoaded = true;
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

    // What the button says while it is doing something. A press that changes nothing visible is
    // read as a press that failed, and the second one gets a 409 from a server that is right.
    get updateButtonLabel() {
      if (this.busy !== 'update') return 'update this host';
      return this.watching ? 'updating…' : 'requesting…';
    },

    // Writes the request and nothing else. What happens next is a root unit's business, and the
    // only thing this page can do is watch the status file the runner leaves behind.
    async requestUpdate() {
      this.busy = 'update';
      this.updateError = null;
      const ref = this.target;
      const since = this.updater?.last?.started_at ?? null;

      try {
        const res = await apiFetch(`${API_BASE}/update`, {
          method: 'POST',
          body: JSON.stringify({ ref, confirm: this.confirmText || undefined }),
        });
        if (!res.ok) {
          this.updateError = (await res.json().catch(() => ({})))?.error?.message ?? `the server answered ${res.status}`;
          this.busy = null;
          return;
        }
      } catch {
        this.updateError = 'could not reach the server';
        this.busy = null;
        return;
      }

      this.confirmText = '';
      // Say so now rather than in three seconds. The first poll of the watch below is a timeout
      // away, and until it lands the panel still reads "nothing in flight" — which is how one
      // press becomes two and the second one is refused.
      if (this.updater) this.updater.pending = true;
      await this.watchUpdate(ref, since);
      this.busy = null;
    },

    // The service is restarted in the middle of what we are watching, so a failed poll is the
    // expected case rather than an error. Stop when the runner reports an end, or give up after
    // the unit's own timeout.
    //
    // `ref` and `since` are what makes "the run we asked for ended" different from "a run ended":
    // the status file still holds the previous outcome until the runner overwrites it, and for
    // the few milliseconds between the request being claimed and the first `running` record,
    // that stale one reads exactly like a finished new one.
    async watchUpdate(ref, since) {
      if (this.watching) return;
      this.watching = true;
      const deadline = Date.now() + 15 * 60 * 1000;
      let finished = null;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        await this.fetchUpdater();
        const last = this.updater?.last;
        const ours = last && last.ref === ref && last.started_at !== since;
        if (!this.updater?.pending && ours && last.state !== 'running') {
          finished = last;
          break;
        }
      }

      this.watching = false;
      // The version, the commit, the uptime and every panel behind them belong to a process that
      // no longer exists. Re-reading one card would leave the rest of the page lying.
      if (finished?.state === 'ok') {
        window.location.reload();
        return;
      }
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

    // A swallowed write is worse than a swallowed read: the switch springs back and the operator
    // is left believing a routing state that was never applied.
    async toggleProvider(prov) {
      this.busy = prov.name;
      this.toggleError = null;
      try {
        const res = await apiFetch(`${API_BASE}/providers/${prov.name}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !prov.enabled }),
        });
        if (res.ok) {
          await this.fetchProviders();
        } else {
          this.toggleError = `${prov.name} was not changed — the gateway answered ${res.status}.`;
        }
      } catch {
        this.toggleError = `${prov.name} was not changed — the gateway did not answer.`;
      }
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

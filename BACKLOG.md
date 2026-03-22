# Admin Dashboard — Aspirational Screens

Features and UI patterns shown in the Stitch-generated screens that do **not** have backend
support yet. Each section documents what the screen shows, what is missing from the codebase,
and what would need to be built to make it real.

Reference screens live in `docs/screens/`. When implementing a feature from this list,
move it to the active sprint and update the corresponding screen's `code.html` to use
real data instead of mock data.

---

## 1. Models Page — Provider Discovery & Setup

**Screen:** `docs/screens/models_shellm_admin_dashboard/`

### What the screen shows

- Provider cards for **Mistral AI** and **Ollama Local** in an "unconnected" state
- A **"Setup"** button on unconnected provider cards that presumably launches a configuration flow
- A **"Configure"** button on connected providers to edit settings
- A **Context Window** column in the Full Model Registry table (e.g., `200K`, `32K`)
- Provider IDs in `vendor/model-name` format (e.g., `anthropic/claude-3-opus-20240229`, `mistral/mistral-large-latest`)

### What exists today

| Feature | Status |
|---|---|
| claude, gemini, codex, cerebras provider cards | ✅ Real |
| Provider enabled/disabled toggle | ✅ Real |
| Auth status (authenticated / not installed) | ✅ Real |
| Model tags per provider | ✅ Real |
| Mistral AI provider | ❌ Not implemented |
| Ollama Local provider | ❌ Not implemented |
| "Setup" / "Configure" UI flow | ❌ Not implemented |
| Context window metadata per model | ❌ Not tracked in backend |
| `vendor/model-name` ID format | ❌ Current format is flat (e.g., `claude-sonnet`) |

### What needs to be built

1. **Mistral provider** (`src/providers/mistral.js`) — API-based, similar to Cerebras
2. **Ollama provider** (`src/providers/ollama.js`) — HTTP to local Ollama instance (`http://localhost:11434`)
3. **Provider configuration UI** — A form/modal to set provider-specific config (API key, base URL). Currently all config is via `.env`.
4. **Context window metadata** — Add `context_window` field to the provider contract and surface it in `GET /v1/models`
5. **Admin API endpoint** — `POST /admin/providers/:name/configure` to update provider settings without restarting

### Design reference

`docs/screens/models_shellm_admin_dashboard/code.html` — use as layout reference for
the cards grid + registry table. Strip Mistral/Ollama cards and "Setup" buttons until
those providers are implemented.

---

## 2. Overview — Real-Time Terminal Log Feed

**Screen:** `docs/screens/shellm_admin_dashboard_overview/`

### What the screen shows

- A **live terminal feed** panel showing streaming log entries with timestamps, status codes, and request IDs
- Entries appear to animate in as new requests arrive (real-time push)
- `SYSTEM_STATUS: OK` footer in terminal style

### What exists today

| Feature | Status |
|---|---|
| Request log table (paginated, filterable) | ✅ Real — on the Logs page |
| `GET /admin/logs` API endpoint | ✅ Real |
| `SYSTEM_STATUS` footer line | ✅ Trivial — static text |
| Real-time log streaming (WebSocket / SSE) | ❌ Not implemented |
| Auto-updating log feed without page reload | ❌ Not implemented |

### What needs to be built

1. **SSE endpoint** — `GET /admin/logs/stream` that emits log entries as `text/event-stream`
2. **Alpine.js EventSource client** — in `overview.js`, open `EventSource('/admin/logs/stream')` and prepend entries to the feed
3. **Rate-limiting the stream** — Batch entries or throttle to avoid flooding the browser at high request rates

### Design reference

`docs/screens/shellm_admin_dashboard_overview/code.html` — the terminal feed panel at
the bottom of the screen. The `SYSTEM_STATUS: OK` footer is a one-liner that can be
added immediately as static text.

---

## 3. Overview — Quick Operations Panel

**Screen:** `docs/screens/shellm_admin_dashboard_overview/`

### What the screen shows

- **"New Deployment"** button — unclear what this triggers in context
- **"Export Logs"** button — exports the request log as CSV or JSON

### What exists today

| Feature | Status |
|---|---|
| Export Logs | ❌ Not implemented |
| New Deployment | ❌ Unclear scope — likely out of scope for this service |

### What needs to be built

1. **Export Logs** — `GET /admin/logs/export?format=csv` endpoint that streams the full log table as CSV. High value, low effort.
2. **New Deployment** — Likely out of scope. SheLLM is not a deployment orchestrator. Remove this button from the implementation.

---

## 4. Overview — Security Alert Widget

**Screen:** `docs/screens/shellm_admin_dashboard_overview/`

### What the screen shows

- A highlighted alert card: "Security Alert — Unusual API key activity detected on key `sk-prod-...`"
- Implies anomaly detection on per-key usage patterns

### What exists today

| Feature | Status |
|---|---|
| Per-key request logging | ✅ Real |
| Admin brute-force lockout | ✅ Real |
| Anomaly detection / alerting | ❌ Not implemented |

### What needs to be built

1. **Usage anomaly heuristic** — Compare current RPM to historical average per key; flag if > 3x baseline
2. **Alert surface** — Store alerts in SQLite (`alerts` table), expose via `GET /admin/alerts`
3. **Dashboard widget** — Show the latest unacknowledged alert in the Overview with a dismiss button

### Notes

This is high-effort, medium-value for the current scale. Deprioritize until the service
has multiple active clients with meaningful traffic baselines.

---

## Priority Order

| Feature | Effort | Value | Recommended |
|---|---|---|---|
| Export Logs CSV | Low | High | ✅ Next sprint |
| Ollama provider | Medium | High | ✅ Next sprint |
| `SYSTEM_STATUS` footer (static) | Trivial | Low | ✅ Implement now (cosmetic) |
| Context window metadata | Low | Medium | 🟡 Backlog |
| Mistral provider | Medium | Medium | 🟡 Backlog |
| Real-time log stream (SSE) | High | Medium | 🟡 Backlog |
| Provider configuration UI | High | Medium | 🟡 Backlog |
| Security alert widget | High | Low | 🔴 Deprioritize |
| New Deployment button | — | — | ❌ Out of scope — remove |

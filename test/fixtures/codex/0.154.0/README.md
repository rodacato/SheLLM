# codex 0.154.0 — recorded CLI output

Captured by spawning the real binary the way `src/providers/base.js` does (stdio ignored, a temp
cwd, the provider's own environment):

```bash
codex exec --ephemeral --skip-git-repo-check -s read-only --json -m gpt-5.6-sol 'Reply with exactly: OK'
```

| File | Origin |
|---|---|
| `exec-json.jsonl` | captured — a successful turn |
| `exec-json-unknown-model.jsonl` | captured — `-m shellm-no-such-model`, exit 1 |
| `exec-json-usage-limit.constructed.jsonl` | **constructed**, not captured |
| `exec-json-output-schema.jsonl` | captured — `--output-schema` with a strict two-field schema |
| `exec-json-invalid-schema.jsonl` | captured — `--output-schema` with a schema strict mode refuses (no `additionalProperties: false`), exit 1 |

The usage-limit file reuses the `error` / `turn.failed` envelope of the captured unknown-model run
with a 429 payload, because a real quota exhaustion cannot be provoked on demand. It is named
`.constructed.` so nobody mistakes it for a recording. Re-record it the first time a real usage
limit is hit, and drop the suffix.

# claude 2.1.312 — recorded CLI output

Captured on 2026-10-28 by spawning the real binary with the argv the landing page's inspector
shows (`site/inspector.json`, scenario `openai-stream`), in a temp cwd with a minimal environment,
prompt `Count to 5, one number per line.` on stdin.

| File | Origin |
|---|---|
| `stream-json.jsonl` | captured. The temp paths in the `init` event were replaced with `/tmp/shellm-req` |

Since 2.1.273 the `rate_limit_event` arrives after `message_stop` instead of before the stream.

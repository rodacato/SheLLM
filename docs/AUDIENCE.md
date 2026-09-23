# SheLLM Audience

> For something to qualify as a feature, someone on this list must actually need it.
> If nobody here needs it, it doesn't get built.
>
> One of three files here that configure the maintainer's AI assistant rather than document the
> product — see [`README.md`](./README.md). This is the one worth reading anyway.
> Last updated: **2026-09-21** — the latency note now reflects ADR-0006.

## Primary user — the maintainer, integrating his own work

One person who pays for Claude Max and ChatGPT/Codex subscriptions and wants to use them
from his own software instead of buying API credits on top. He reaches SheLLM in three ways:

1. **His own apps**, running as services on his own server — a learning platform, a personal
   agent, a blog pipeline. They call SheLLM the way they would call a provider API: an OpenAI or
   Anthropic SDK with the base URL swapped.
2. **Scripts and automations** — `curl`, a shell script, an n8n workflow, a cron job.
3. **Experiments** — trying a model or a prompt shape before it becomes a feature somewhere else.

What he needs from SheLLM, in the order he feels it:

- **It answers like the real API.** An SDK pointed at SheLLM behaves as if it were talking to
  OpenAI or Anthropic: same request shape, same response shape, same error shape, streaming
  included. Every divergence is something he has to remember in every app.
- **It is fast enough to sit in a request path.** Every request starts a CLI and pays for it —
  about 0.9 s of a short call on the server, and that cold start is permanent
  ([ADR-0006](./adr/0006-spawn-per-request-stays.md): a pooled process would leak context between
  callers). What made it usable was streaming, so he sees the first words in under two seconds
  rather than waiting for the whole answer.
- **It never gets his accounts banned.** He would rather lose speed than a subscription.
- **He can tell whether he can keep using it.** Before starting work, not after something breaks:
  how much of each subscription he has burned and at what pace, without opening each provider's
  site and doing the arithmetic in his head. Neither CLI reports remaining quota or a reset time,
  so SheLLM derives consumption from what it observes and reports a limit only once a provider
  has actually refused a request. A percentage remaining would be a guess presented as a fact.
- **He can tell what happened** from the admin dashboard or one `curl`: which provider answered,
  how long it queued, why it failed.

### Consult as `el-integrador`

The primary user is also a seat on the [expert panel](./EXPERTS.md) — **C9 `el-integrador`**: the
maintainer at 11 PM with a half-built feature in another repo, wiring SheLLM in because he needs
an LLM call *now*. Kept apart from the builder on purpose: the builder wants the elegant process
pool; the integrator wants the SDK to work on the first try.

- **Who he is in that moment:** in the other project's context, not SheLLM's. He will not read a
  guide; he copies the base URL and a key.
- **Consult on:** every API shape, every error message, every setup step, every "should we add X".
- **His job is to veto** anything that serves SheLLM's own ambition over that moment — a new
  endpoint no app calls, a config knob he must learn, a divergence from the provider API "because
  it's cleaner".
- **His voice:** short and impatient. *"I don't care how it works. Does the OpenAI SDK just work?"*

## Secondary — self-hosters running their own subscriptions

Developers who clone SheLLM and run it on their own server, with their own CLI logins, for their
own projects.

- They are served by **setup, docs and safety**: a clean install path, a working first request in
  minutes, and defaults that can't get them banned or exposed.
- They are **not** a reason to build a feature. A feature exists because the primary user needs
  it; self-hosters get it for free. If real self-hosters show up with a repeated, documented need,
  that is an ADR, not a backlog item.
- What they get: MIT code, documented setup, their data on their server. What they do not get: an
  SLA, support, or advance notice of breaking changes.

## Non-users (what SheLLM is explicitly NOT for)

- ❌ **Anyone using a subscription that isn't theirs.** Sharing one person's Claude or
  ChatGPT login with other people, a team or paying customers breaks the providers' terms and is
  exactly how accounts get banned. No multi-tenant mode, no reselling, no "shared key pool".
- ❌ **Teams and organizations.** One admin, one owner of the subscriptions. No roles, no orgs, no
  per-user billing.
- ❌ **Production traffic at scale.** A CLI subscription has usage limits built for one person.
  High-volume or latency-critical workloads belong on the provider's paid API.
- ❌ **Anyone who wants a different client than the official one.** SheLLM drives the official,
  unmodified CLI binaries. Token extraction, client spoofing and "anti-ban" cloaking are out.
- ❌ **The general public arriving via Google.** No funnel, no SEO, no hosted version.

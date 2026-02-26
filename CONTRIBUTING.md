# Contributing to SheLLM

## Getting Started

### Prerequisites

- Node.js >= 22
- Docker and Docker Compose
- Access to at least one CLI tool (Claude Code, Gemini CLI, or Codex CLI)

### Development Setup

```bash
# Clone and install
git clone <repo-url> && cd shellm
npm install

# Start in development mode (auto-restart on changes)
npm run dev

# Run tests
npm test
```

### Using the Dev Container

The project includes a full devcontainer configuration. Open in VS Code with the Dev Containers extension, or use GitHub Codespaces.

```bash
# The devcontainer installs all CLI tools automatically
# After opening, verify:
claude --version
gemini --version
codex --version
```

## Code Conventions

### Language & Style

- **CommonJS** — `require()` / `module.exports` (no ESM)
- **Semicolons** — yes
- **Single quotes** — for strings
- **2 spaces** — for indentation
- **Trailing commas** — in multi-line objects and arrays
- **No TypeScript** — plain JavaScript with clear naming

### Architecture Rules

1. **One dependency** (Express). Don't add packages unless you can justify why a Node.js built-in won't work.
2. **One file per provider.** Each provider is a self-contained module with the same export shape.
3. **No classes.** Providers export plain objects with functions. No inheritance, no `this` binding issues.
4. **Errors are objects, not strings.** Every error response has `{ error, message, request_id }`.
5. **No silent failures.** If something fails, it returns a structured error with an actionable message.

### Provider Contract

Every provider in `src/providers/` must export:

```javascript
module.exports = {
  name: 'provider-name',
  chat: async ({ prompt, system, max_tokens, model }) => {
    return { content: '...', cost_usd: null };
  },
  validModels: ['model-a', 'model-b'],
  capabilities: {
    supports_system_prompt: true,
    supports_json_output: false,
    supports_max_tokens: true,
    cli_command: 'cli-tool --flag',
  },
};
```

## Adding a New Provider

1. Create `src/providers/<name>.js` following the contract above
2. Add the provider to the `providers` object in `src/router.js`
3. Add a health check in `src/health.js`
4. Write tests in `test/providers/<name>.test.js`
5. Update the `GET /providers` response implicitly (it reads from the router)

For CLI-based providers, use `execute()` from `src/providers/base.js`:

```javascript
const { execute } = require('./base');

async function chat({ prompt, system, max_tokens }) {
  const args = buildArgs({ prompt, system, max_tokens });
  const result = await execute('cli-command', args);
  return parseOutput(result.stdout);
}
```

For API-based providers, use `fetch()` directly (no SDK).

## Testing

### Running Tests

```bash
# All tests
npm test

# Specific test file
node --test test/providers/claude.test.js
```

### Test Guidelines

- Use Node.js built-in test runner (`node:test`)
- Mock subprocess calls at the `execute()` boundary — don't spawn real CLIs in CI
- API tests import the Express `app` directly — don't start a server
- Tests should be fast (< 5s total) and deterministic (no network calls, no timers)

## Commit Messages

Write clear, imperative commit messages:

```
Add Cerebras provider with model mapping

Fix timeout handling for slow Claude responses

Update health check to verify Gemini auth status
```

- First line: imperative mood, under 72 characters
- Body (if needed): explain the "why", not the "what"
- No emoji prefixes, no conventional commit tags required

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a brief description of what changed and why
- If the PR changes the API contract, document the change
- All tests must pass before merging

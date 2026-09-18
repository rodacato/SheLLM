const claude = require('../providers/claude');
const codex = require('../providers/codex');

// Execution engines — keyed by provider name for chat/chatStream dispatch
const engines = { claude, codex };

module.exports = { engines };

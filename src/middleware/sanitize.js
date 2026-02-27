function sanitizeInput(req, _res, next) {
  if (req.body.prompt) {
    req.body.prompt = sanitize(req.body.prompt);
  }
  if (req.body.system) {
    req.body.system = sanitize(req.body.system);
  }
  next();
}

function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')       // Strip null bytes
    .replace(/\r/g, '');      // Normalize line endings
}

module.exports = { sanitizeInput, sanitize };

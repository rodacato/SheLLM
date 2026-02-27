function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')       // Strip null bytes
    .replace(/\r/g, '');      // Normalize line endings
}

module.exports = { sanitize };

function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKC')                                            // canonical + compat decomposition
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '')    // strip zero-width chars
    .replace(/\0/g, '')                                            // strip null bytes
    .replace(/\r/g, '');                                           // normalize line endings
}

module.exports = { sanitize };

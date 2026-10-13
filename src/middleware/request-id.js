const { randomUUID } = require('node:crypto');

// Runs again once a late-parsed body is in, so a body request_id replaces the generated one.
function requestId(req, res, next) {
  req.requestId =
    req.headers['x-request-id'] ||
    req.body?.request_id ||
    req.requestId ||
    randomUUID();
  res.set('x-request-id', req.requestId);
  next();
}

module.exports = { requestId };

const { randomUUID } = require('node:crypto');

function requestId(req, res, next) {
  req.requestId =
    req.headers['x-request-id'] ||
    req.body?.request_id ||
    randomUUID();
  res.set('x-request-id', req.requestId);
  next();
}

module.exports = { requestId };

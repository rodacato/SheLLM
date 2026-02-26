const { randomUUID } = require('node:crypto');

function requestId(req, _res, next) {
  req.requestId =
    req.headers['x-request-id'] ||
    req.body?.request_id ||
    randomUUID();
  next();
}

module.exports = { requestId };

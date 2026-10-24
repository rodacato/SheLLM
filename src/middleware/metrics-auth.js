const { createHash, timingSafeEqual } = require('node:crypto');
const config = require('../config');
const { sendApiError, authRequired, notFound } = require('../errors');

const digest = (value) => createHash('sha256').update(value).digest();

// Fail closed: with no token the endpoint answers exactly like a route that does not exist.
function metricsAuth(req, res, next) {
  const token = config.get('METRICS_TOKEN');
  if (!token) return sendApiError(req, res, notFound(req.method, req.path), req.requestId);

  const [scheme, provided] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !provided || !timingSafeEqual(digest(provided), digest(token))) {
    res.set('WWW-Authenticate', 'Bearer');
    return sendApiError(req, res, authRequired(), req.requestId);
  }
  next();
}

module.exports = { metricsAuth };

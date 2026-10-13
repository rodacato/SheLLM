const { sendApiError, invalidRequest, payloadTooLarge } = require('../errors');
const { requestId } = require('./request-id');
const logger = require('../lib/logger');

// Express's own handler answers HTML, with a stack trace outside production. Every caller here
// parses JSON, so whatever reaches next(err) leaves in the shape the path speaks.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // A body that failed to parse never reached the request-id middleware.
  if (!req.requestId) requestId(req, res, () => {});

  if (err.type === 'entity.parse.failed') {
    return sendApiError(req, res, invalidRequest('Request body is not valid JSON'), req.requestId);
  }
  if (err.type === 'entity.too.large') {
    return sendApiError(req, res, payloadTooLarge(`Request body exceeds ${err.limit} bytes`), req.requestId);
  }

  logger.error({ event: 'unhandled_error', error: err.message, path: req.path, request_id: req.requestId });
  return sendApiError(req, res, { status: 500, code: 'internal_error', message: 'Internal server error' }, req.requestId);
}

module.exports = { errorHandler };

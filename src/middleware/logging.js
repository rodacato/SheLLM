function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    const requestId = req.body?.request_id || '-';
    console[level](
      `${method} ${url} ${res.statusCode} ${duration}ms [${requestId}]`
    );
  });

  next();
}

module.exports = { requestLogger };

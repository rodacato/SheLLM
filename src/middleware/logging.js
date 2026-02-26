function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      request_id: req.requestId || null,
      client: req.clientName || null,
    };

    if (res.statusCode >= 400) {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  });

  next();
}

module.exports = { requestLogger };

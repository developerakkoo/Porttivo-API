const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function safeBodySummary(body) {
  if (!body || typeof body !== 'object') {
    return null
  }

  return {
    keys: Object.keys(body).slice(0, 12),
    hasFiles: Boolean(body.files || body.file || body.attachments)
  }
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim()
  }

  return req.ip || req.socket?.remoteAddress || null
}

function logApiRequest(req, res, next) {
  const startedAt = Date.now()
  const requestPath = req.originalUrl || req.url || req.path || ''

  res.once('finish', () => {
    const durationMs = Date.now() - startedAt
    const statusCode = res.statusCode
    const level =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log'
    const logger = console[level] || console.log

    logger(
      '[API]',
      JSON.stringify({
        method: req.method,
        path: requestPath,
        statusCode,
        durationMs,
        userType: req.user?.userType || null,
        userId: req.user?.id || null,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 160)
          : null,
        result: statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'FAILURE' : 'SUCCESS',
        ...(MUTATING_METHODS.has(req.method)
          ? { body: safeBodySummary(req.body) }
          : {})
      })
    )
  })

  next()
}

module.exports = {
  logApiRequest
}

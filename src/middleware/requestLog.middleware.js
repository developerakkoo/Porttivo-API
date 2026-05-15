function serializePayload(payload) {
  if (payload === undefined) {
    return null
  }

  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf8')
  }

  if (typeof payload === 'string') {
    return payload
  }

  return payload
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
  let responsePayload

  console.log(
    '[API][START]',
    JSON.stringify({
      method: req.method,
      path: requestPath,
      userType: req.user?.userType || null,
      userId: req.user?.id || null,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
        ? String(req.headers['user-agent']).slice(0, 160)
        : null
    })
  )

  const originalJson = res.json.bind(res)
  const originalSend = res.send.bind(res)

  res.json = function (body) {
    responsePayload = body
    res.json = originalJson
    res.send = originalSend
    return originalJson(body)
  }

  res.send = function (body) {
    responsePayload = body
    res.json = originalJson
    res.send = originalSend
    return originalSend(body)
  }

  res.once('finish', () => {
    const durationMs = Date.now() - startedAt
    const statusCode = res.statusCode
    const level =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log'
    const logger = console[level] || console.log

    logger(
      '[API][DONE]',
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
        response: serializePayload(responsePayload)
      })
    )
  })

  next()
}

module.exports = {
  logApiRequest
}

const { error, info, warn } = require('../utils/logger')

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

function summarizePayload(payload) {
  if (payload === null || payload === undefined) {
    return null
  }

  if (typeof payload === 'string') {
    return payload
  }

  if (typeof payload !== 'object') {
    return String(payload)
  }

  const parts = []

  if (Object.prototype.hasOwnProperty.call(payload, 'success')) {
    parts.push(`success: ${payload.success}`)
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'message') && payload.message) {
    parts.push(`message: ${payload.message}`)
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'error') && payload.error) {
    parts.push(`error: ${payload.error}`)
  }

  if (Array.isArray(payload.data)) {
    parts.push(`data: ${payload.data.length} items`)
  } else if (
    payload.data &&
    typeof payload.data === 'object' &&
    Object.keys(payload.data).length > 0
  ) {
    parts.push(`data: object`)
  }

  if (parts.length === 0) {
    const keys = Object.keys(payload).slice(0, 5)
    if (keys.length > 0) {
      parts.push(`keys: ${keys.join(', ')}`)
    }
  }

  return parts.length > 0 ? parts.join(', ') : null
}

function logApiRequest(req, res, next) {
  let responsePayload

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
    const payload = serializePayload(responsePayload)
    const summary = summarizePayload(payload)
    if (!summary) {
      return
    }

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    const logger = level === 'error' ? error : level === 'warn' ? warn : info
    logger(summary)
  })

  next()
}

module.exports = {
  logApiRequest
}

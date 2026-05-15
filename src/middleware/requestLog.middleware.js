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
    if (payload !== null) {
      console.log(payload)
    }
  })

  next()
}

module.exports = {
  logApiRequest
}

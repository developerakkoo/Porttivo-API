const util = require('util')

const LEVEL_TO_STREAM = {
  error: process.stderr,
  warn: process.stderr,
  info: process.stdout,
  debug: process.stdout
}

let consoleFormatterInstalled = false

function formatTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return String(value)
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `[${value.length} items]`
  }

  if (value instanceof Error) {
    return value.stack || value.message
  }

  return util.inspect(value, {
    depth: 1,
    breakLength: 120,
    compact: true,
    sorted: true
  })
}

function formatContext(context) {
  if (!context || typeof context !== 'object') {
    return ''
  }

  const entries = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatValue(value)}`)

  return entries.join(', ')
}

function write(level, message, context) {
  const stream = LEVEL_TO_STREAM[level] || process.stdout
  const contextText = formatContext(context)
  const line = `${formatTimestamp()} [${level}]: ${formatValue(message)}${
    contextText ? ` (${contextText})` : ''
  }\n`
  stream.write(line)
}

function info(message, context) {
  write('info', message, context)
}

function warn(message, context) {
  write('warn', message, context)
}

function error(message, context) {
  write('error', message, context)
}

function debug(message, context) {
  write('debug', message, context)
}

function installConsoleFormatter() {
  if (consoleFormatterInstalled) {
    return
  }

  consoleFormatterInstalled = true

  console.log = (...args) => info(args.map(formatValue).join(' '))
  console.info = (...args) => info(args.map(formatValue).join(' '))
  console.warn = (...args) => warn(args.map(formatValue).join(' '))
  console.error = (...args) => error(args.map(formatValue).join(' '))
  console.debug = (...args) => debug(args.map(formatValue).join(' '))
}

module.exports = {
  debug,
  error,
  info,
  installConsoleFormatter,
  warn
}

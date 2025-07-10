import fs from 'fs'
import path from 'path'

// Supported log levels
const levels = ['silent', 'error', 'warn', 'info', 'debug']
const currentLevel = levels.indexOf(process.env.LOG_LEVEL || 'info')

// Create logs directory if it doesn't exist
const logDir = path.resolve(process.cwd(), 'logs')
const logFilePath = path.join(logDir, 'voidgates.log')
fs.mkdirSync(logDir, { recursive: true })

function log(level, ...args) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [${level.toUpperCase()}] ${args.join(' ')}`

  // Console output based on log level
  if (levels.indexOf(level) <= currentLevel && currentLevel > 0) {
    console.log(line)
  }

  // Always write to file regardless of console level
  fs.appendFileSync(logFilePath, line + '\n', 'utf8')
}

export const logger = {
  error: (...args) => log('error', ...args),
  warn:  (...args) => log('warn', ...args),
  info:  (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args),
}
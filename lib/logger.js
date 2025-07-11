import fs from 'fs'
import path from 'path'

// Supported log levels
const levels = ['silent', 'error', 'warn', 'info', 'debug']
const currentLevel = levels.indexOf(process.env.LOG_LEVEL || 'info')

// Determine the log directory based on ENV path or fallback to cwd
const envPath = process.env.VOIDGATES_ENV_PATH || path.resolve(process.cwd(), '.env')
const baseDir = path.dirname(envPath)
const logFilePath = path.join(baseDir, 'voidgates.log')

function log(level, ...args) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [${level.toUpperCase()}] ${args.join(' ')}`

  if (levels.indexOf(level) <= currentLevel && currentLevel > 0) {
    console.log(line)
  }

  fs.appendFileSync(logFilePath, line + '\n', 'utf8')
}

export const logger = {
  error: (...args) => log('error', ...args),
  warn:  (...args) => log('warn', ...args),
  info:  (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args),
}
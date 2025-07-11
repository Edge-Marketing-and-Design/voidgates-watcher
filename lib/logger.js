import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const levels = ['silent', 'error', 'warn', 'info', 'debug']
const currentLevel = levels.indexOf(process.env.LOG_LEVEL || 'info')

const envPath = process.env.VOIDGATES_ENV_PATH || path.resolve(process.cwd(), '.env')
const baseDir = path.dirname(envPath)
const logFilePath = path.join(baseDir, 'voidgates.log')
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024
const MAX_ARCHIVES = 5

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(logFilePath)) return

    const stats = fs.statSync(logFilePath)
    if (stats.size <= MAX_LOG_SIZE_BYTES) return

    // Rotate and compress current log
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const rotatedName = path.join(baseDir, `voidgates-${timestamp}.log.gz`)
    const gzip = zlib.createGzip()
    const source = fs.createReadStream(logFilePath)
    const destination = fs.createWriteStream(rotatedName)

    source.pipe(gzip).pipe(destination).on('finish', () => {
      fs.unlinkSync(logFilePath)
      cleanupOldArchives()
    })
  } catch (err) {
    console.warn('Log rotation failed:', err)
  }
}

function cleanupOldArchives() {
  const files = fs.readdirSync(baseDir)
    .filter(name => /^voidgates-\d{4}-\d{2}-\d{2}T/.test(name) && name.endsWith('.log.gz'))
    .map(name => ({
      name,
      time: fs.statSync(path.join(baseDir, name)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time) // newest first

  const excess = files.slice(MAX_ARCHIVES)
  for (const file of excess) {
    try {
      fs.unlinkSync(path.join(baseDir, file.name))
    } catch (err) {
      console.warn(`Failed to remove old archive ${file.name}:`, err)
    }
  }
}

function log(level, ...args) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [${level.toUpperCase()}] ${args.join(' ')}`

  if (levels.indexOf(level) <= currentLevel && currentLevel > 0) {
    console.log(line)
  }

  rotateLogIfNeeded()
  fs.appendFileSync(logFilePath, line + '\n', 'utf8')
}

export const logger = {
  error: (...args) => log('error', ...args),
  warn:  (...args) => log('warn', ...args),
  info:  (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args),
}
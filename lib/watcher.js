import fetch from 'node-fetch'
import { Tail } from 'tail'
import { logger } from './logger.js'

const {
  CF_API_TOKEN,
  CF_ACCOUNT_ID,
  VOIDGATES_ZONE,
  LOG_PATH,
  '404_BLOCK_THRESHOLD': BLOCK_THRESHOLD = 10,
  '404_BLOCK_INTERVAL_SECONDS': BLOCK_INTERVAL_SECONDS = 60,
  '404_BLOCK_DURATION_SECONDS': BLOCK_DURATION_SECONDS = '',
  PATH_BLOCK_THRESHOLD = 4,
  PATH_BLOCK_INTERVAL_SECONDS = 60,
  PATH_BLOCK_DURATION_SECONDS = 1800,
  CLEANUP_INTERVAL_SECONDS = 300,
  DRY_RUN = 'false',
} = process.env

console.log('apiToken:', CF_API_TOKEN)
console.log('accountId:', CF_ACCOUNT_ID)
console.log('zoneId:', VOIDGATES_ZONE)
console.log('logPath:', LOG_PATH)

const BLOCK_NOTE_PREFIX = 'VoidGates 404 Abuse -'
const PATH_BLOCK_NOTE_PREFIX = 'VoidGates Path Abuse -'
const ipTracker = new Map()
const pathTracker = new Map()
const intervalMs = Number(BLOCK_INTERVAL_SECONDS) * 1000
const pathIntervalMs = Number(PATH_BLOCK_INTERVAL_SECONDS) * 1000
const cleanupInterval = Number(CLEANUP_INTERVAL_SECONDS) * 1000
const blockDurationMs = BLOCK_DURATION_SECONDS ? Number(BLOCK_DURATION_SECONDS) * 1000 : null
const pathBlockDurationMs = PATH_BLOCK_DURATION_SECONDS ? Number(PATH_BLOCK_DURATION_SECONDS) * 1000 : null

if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !LOG_PATH) {
  logger.error('Missing required environment variables.')
  process.exit(1)
}

function is404(line) {
  const match = line.match(/"\s(\d{3})\s/)
  return match && match[1] === '404'
}

function extractIP(line) {
  return line.split(' ')[0]
}

function extractPath(line) {
  const match = line.match(/"[A-Z]+\s([^\s]+)\sHTTP/)
  return match ? match[1] : null
}

function record404Hit(ip) {
  const now = Date.now()
  const data = ipTracker.get(ip) || { count: 0, start: now }

  if (now - data.start > intervalMs) {
    ipTracker.set(ip, { count: 1, start: now })
  } else {
    data.count++
    ipTracker.set(ip, data)
  }

  return data.count >= BLOCK_THRESHOLD
}

function recordPathHit(ip, path) {
  if (!path) return false

  // Skip common non-page paths
  if (
    path.startsWith('/api') ||
    path.startsWith('/wp-json/') ||
    path.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|ogg|json)(\?|$)/i)
  ) {
    return false
  }

  const now = Date.now()
  const key = `${ip}:${path}`
  const data = pathTracker.get(key) || { count: 0, start: now }

  if (now - data.start > pathIntervalMs) {
    pathTracker.set(key, { count: 1, start: now })
  } else {
    data.count++
    pathTracker.set(key, data)
  }

  return data.count >= PATH_BLOCK_THRESHOLD
}

async function blockIp(ip, type = '404', path = null) {
  const timestamp = new Date().toISOString()
  const note = `${type === 'path' ? PATH_BLOCK_NOTE_PREFIX : BLOCK_NOTE_PREFIX} ${timestamp}`

  if (DRY_RUN === 'true') {
    logger.info(`[Dry Run] Block triggered for IP: ${ip} @ ${timestamp} [Type: ${type}${type === 'path' && path ? ` | Path: ${path}` : ''}]`)
    logger.debug(`[Dry Run] Would POST to Cloudflare with note: "${note}"`)
    ipTracker.delete(ip)
    return
  }

  const url = VOIDGATES_ZONE
    ? `https://api.cloudflare.com/client/v4/zones/${VOIDGATES_ZONE}/firewall/access_rules/rules`
    : `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/firewall/access_rules/rules`

  const body = {
    mode: 'block',
    configuration: {
      target: 'ip',
      value: ip,
    },
    notes: note,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const json = await res.json()
    if (json.success) {
      logger.info(`Blocked IP: ${ip} @ ${timestamp} [Type: ${type}${type === 'path' && path ? ` | Path: ${path}` : ''}]`)
    } else {
      logger.error('Cloudflare block error:', JSON.stringify(json.errors))
    }
  } catch (err) {
    logger.error('Block request failed:', err.message)
  }

  ipTracker.delete(ip)
}

async function cleanExpiredBlocks() {
  let page = 1
  let hasMore = true

  const listUrl = VOIDGATES_ZONE
    ? `https://api.cloudflare.com/client/v4/zones/${VOIDGATES_ZONE}/firewall/access_rules/rules`
    : `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/firewall/access_rules/rules`

  while (hasMore) {
    try {
      const res = await fetch(`${listUrl}?page=${page}&per_page=100`, {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      })

      const json = await res.json()
      if (!json.success) {
        logger.error('Failed to list access rules:', JSON.stringify(json.errors))
        return
      }

      const entries = json.result || []
      for (const rule of entries) {
        const isPathBlock = rule.notes?.startsWith(PATH_BLOCK_NOTE_PREFIX)
        const is404Block = rule.notes?.startsWith(BLOCK_NOTE_PREFIX)

        if ((isPathBlock || is404Block) && ['ip', 'ip6'].includes(rule.configuration?.target)) {
          // console.log(rule)
          const timestamp = rule.notes.replace(`${isPathBlock ? PATH_BLOCK_NOTE_PREFIX : BLOCK_NOTE_PREFIX} `, '').trim()
          const expirationMs = isPathBlock ? pathBlockDurationMs : blockDurationMs

          if (!expirationMs || expirationMs <= 0) continue

          const expired = Date.now() - new Date(timestamp).getTime() > expirationMs
          if (expired) {
            await deleteRule(rule.id)
          }
        }
      }

      hasMore = json.result_info.page < json.result_info.total_pages
      page++
    } catch (err) {
      logger.error('[Cleanup] Request failed:', err.message)
      return
    }
  }
}

async function deleteRule(id) {
  if (DRY_RUN === 'true') {
    logger.info(`[Dry Run] Would delete rule ID: ${id}`)
    return
  }

  const url = VOIDGATES_ZONE
    ? `https://api.cloudflare.com/client/v4/zones/${VOIDGATES_ZONE}/firewall/access_rules/rules/${id}`
    : `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/firewall/access_rules/rules/${id}`

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })

    const json = await res.json()
    if (json.success) {
      logger.info(`[Cleanup] Removed expired block ID: ${id}`)
    } else {
      logger.error(`[Cleanup] Failed to delete rule ID ${id}:`, JSON.stringify(json.errors))
    }
  } catch (err) {
    logger.error(`[Cleanup] Delete request failed for ID ${id}:`, err.message)
  }
}

export function startWatcher() {
  const tail = new Tail(LOG_PATH)

  tail.on('line', async (line) => {
    const ip = extractIP(line)
    const path = extractPath(line)

    if (is404(line)) {
      if (record404Hit(ip)) {
        await blockIp(ip, '404')
        return
      }
    }

    if (recordPathHit(ip, path)) {
      await blockIp(ip, 'path', path)
    }
  })

  function cleanupTrackers() {
    const now = Date.now()

    // Clean 404 tracker
    for (const [ip, data] of ipTracker.entries()) {
      if (now - data.start > intervalMs) {
        ipTracker.delete(ip)
      }
    }

    // Clean path tracker
    for (const [key, data] of pathTracker.entries()) {
      if (now - data.start > pathIntervalMs) {
        pathTracker.delete(key)
      }
    }
  }

  tail.on('error', (err) => {
    logger.error('Tail error:', err.message)
  })

  logger.info('VoidGates Watcher is running...')
  setInterval(cleanupTrackers, 5 * 60 * 1000) 
  setInterval(cleanExpiredBlocks, cleanupInterval)
}
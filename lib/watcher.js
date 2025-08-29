import fetch from 'node-fetch'
import { Tail } from 'tail'
import { logger } from './logger.js'
import fs from 'fs'

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
  RATE_LIMIT_THRESHOLD = 25,
  RATE_LIMIT_INTERVAL_SECONDS = 30,
  RATE_LIMIT_DURATION_SECONDS = 3600,
  CLEANUP_INTERVAL_SECONDS = 300,
  DRY_RUN = 'false',
  RATE_LIMIT_ACTION = 'managed_challenge',
  PATH_BLOCK_ACTION = 'block',
  '404_BLOCK_ACTION': BLOCK_ACTION = 'block',
} = process.env

console.log('apiToken:', CF_API_TOKEN)
console.log('accountId:', CF_ACCOUNT_ID)
console.log('zoneId:', VOIDGATES_ZONE)
console.log('logPath:', LOG_PATH)

const BLOCK_NOTE_PREFIX = 'VoidGates 404 Abuse -'
const PATH_BLOCK_NOTE_PREFIX = 'VoidGates Path Abuse -'
const RATE_BLOCK_NOTE_PREFIX = 'VoidGates Rate Limit -'
const ipTracker = new Map()
const pathTracker = new Map()
const rateTracker = new Map()
const intervalMs = Number(BLOCK_INTERVAL_SECONDS) * 1000
const pathIntervalMs = Number(PATH_BLOCK_INTERVAL_SECONDS) * 1000
const cleanupInterval = Number(CLEANUP_INTERVAL_SECONDS) * 1000
const blockDurationMs = BLOCK_DURATION_SECONDS ? Number(BLOCK_DURATION_SECONDS) * 1000 : null
const pathBlockDurationMs = PATH_BLOCK_DURATION_SECONDS ? Number(PATH_BLOCK_DURATION_SECONDS) * 1000 : null
const rateIntervalMs = Number(RATE_LIMIT_INTERVAL_SECONDS) * 1000
const rateBlockDurationMs = RATE_LIMIT_DURATION_SECONDS ? Number(RATE_LIMIT_DURATION_SECONDS) * 1000 : null

if (!CF_API_TOKEN || (!CF_ACCOUNT_ID && !VOIDGATES_ZONE) || !LOG_PATH) {
  logger.error('Missing required environment variables. Must include CF_API_TOKEN, LOG_PATH, and either CF_ACCOUNT_ID or VOIDGATES_ZONE.')
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

function isAssetPath(path) {
  if (!path) return false
  return (
    path.startsWith('/api') || // in case your server adds one
    path.startsWith('/wp-json/') ||
    path.startsWith('/wp-admin/admin-ajax.php') ||
    path.startsWith('/wp-includes/') ||
    path.startsWith('/wp-content/') ||
    path.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|ogg|json)(\?|$)/i)
  )
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
  if (isAssetPath(path)) {
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

function recordRateHit(ip, path) {
  if (isAssetPath(path)) {
    return false
  }

  const now = Date.now()
  const data = rateTracker.get(ip) || { count: 0, start: now }

  if (now - data.start > rateIntervalMs) {
    rateTracker.set(ip, { count: 1, start: now })
  } else {
    data.count++
    rateTracker.set(ip, data)
  }

  return data.count >= RATE_LIMIT_THRESHOLD
}

async function blockIp(ip, type = '404', path = null, actionOverride) {
  const allowed = new Set(['block', 'managed_challenge'])
  const mode = allowed.has(actionOverride) ? actionOverride : 'block'
  const timestamp = new Date().toISOString()
  const note =
    type === 'path'
      ? `${PATH_BLOCK_NOTE_PREFIX} ${timestamp}`
      : type === 'rate'
      ? `${RATE_BLOCK_NOTE_PREFIX} ${timestamp}`
      : `${BLOCK_NOTE_PREFIX} ${timestamp}`

  if (DRY_RUN === 'true') {
    logger.info(`[Dry Run] Block triggered for IP: ${ip} @ ${timestamp} [Type: ${type}${type === 'path' && path ? ` | Path: ${path}` : ''}] [Mode: ${mode}]`)
    logger.debug(`[Dry Run] Would POST to Cloudflare with note: "${note}"`)
    ipTracker.delete(ip)
    rateTracker.delete(ip)
    return
  }

  const url = VOIDGATES_ZONE
    ? `https://api.cloudflare.com/client/v4/zones/${VOIDGATES_ZONE}/firewall/access_rules/rules`
    : `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/firewall/access_rules/rules`

  const body = {
    mode: mode,
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
      logger.info(`Blocked IP: ${ip} @ ${timestamp} [Type: ${type}${type === 'path' && path ? ` | Path: ${path}` : ''}] [Mode: ${mode}]`)
    } else {
      logger.error('Cloudflare block error:', JSON.stringify(json.errors))
    }
  } catch (err) {
    logger.error('Block request failed:', err.message)
  }

  ipTracker.delete(ip)
  rateTracker.delete(ip)
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
        const isRateBlock = rule.notes?.startsWith(RATE_BLOCK_NOTE_PREFIX)

        if ((isPathBlock || is404Block || isRateBlock) && ['ip', 'ip6'].includes(rule.configuration?.target)) {
          const timestamp = rule.notes
            .replace(
              `${isPathBlock ? PATH_BLOCK_NOTE_PREFIX : isRateBlock ? RATE_BLOCK_NOTE_PREFIX : BLOCK_NOTE_PREFIX} `,
              ''
            )
            .trim()
          const expirationMs = isPathBlock ? pathBlockDurationMs : isRateBlock ? rateBlockDurationMs : blockDurationMs

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


async function syncWhitelist() {
  const whitelistPath = process.env.WHITELIST_PATH
  if (!whitelistPath || String(whitelistPath).trim() === '') {
    // logger.info('[Whitelist] WHITELIST_PATH blank or unset; skipping whitelist sync')
    return
  }

  // Load from local file or remote URL
  async function loadWhitelist(source) {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`Failed to fetch whitelist: ${res.status}`)
      const text = await res.text()
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
      return lines.length ? lines : null
    }

    if (!fs.existsSync(source)) return null
    const lines = fs.readFileSync(source, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean)
    return lines.length ? lines : null
  }

  let desired = []
  try {
    desired = await loadWhitelist(whitelistPath)
  } catch (err) {
    logger.error('[Whitelist] Failed to load whitelist:', err.message)
    return
  }

  if (!desired || desired.length === 0) {
    logger.info('[Whitelist] File missing or empty; skipping whitelist sync')
    return
  }

  const listUrl = VOIDGATES_ZONE
    ? `https://api.cloudflare.com/client/v4/zones/${VOIDGATES_ZONE}/firewall/access_rules/rules`
    : `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/firewall/access_rules/rules`

  const existing = []
  let page = 1
  let hasMore = true

  // Collect all rules across paginated results
  while (hasMore) {
    const res = await fetch(`${listUrl}?page=${page}&per_page=100`, {
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })
    const json = await res.json()
    if (!json.success) {
      logger.error('[Whitelist] Failed to list rules:', JSON.stringify(json.errors))
      return
    }

    existing.push(...(json.result ?? []))
    hasMore = json.result_info.page < json.result_info.total_pages
    page++
  }

  const existingWhitelist = existing.filter(
    rule =>
      rule.notes?.startsWith('VoidGates Whitelist') &&
      ['ip', 'ip6'].includes(rule.configuration?.target)
  )

  const currentIps = new Set(existingWhitelist.map(rule => rule.configuration.value))
  const desiredIps = new Set(desired)

  // Add missing IPs
  for (const ip of desiredIps) {
    if (!currentIps.has(ip)) {
      const body = {
        mode: 'whitelist',
        configuration: {
          target: ip.includes(':') ? 'ip6' : 'ip',
          value: ip,
        },
        notes: 'VoidGates Whitelist',
      }

      if (DRY_RUN === 'true') {
        logger.info(`[Dry Run] Would add whitelist for IP: ${ip}`)
        continue
      }

      const res = await fetch(listUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const json = await res.json()
      if (json.success) {
        logger.info(`[Whitelist] Added IP to whitelist: ${ip}`)
      } else {
        logger.error(`[Whitelist] Failed to add IP ${ip}:`, JSON.stringify(json.errors))
      }
    }
  }

  // Remove stale IPs
  for (const rule of existingWhitelist) {
    if (!desiredIps.has(rule.configuration.value)) {
      const deleteUrl = `${listUrl}/${rule.id}`

      if (DRY_RUN === 'true') {
        logger.info(`[Dry Run] Would remove whitelist for IP: ${rule.configuration.value}`)
        continue
      }

      const res = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      })

      const json = await res.json()
      if (json.success) {
        logger.info(`[Whitelist] Removed stale IP from whitelist: ${rule.configuration.value}`)
      } else {
        logger.error(`[Whitelist] Failed to remove IP ${rule.configuration.value}:`, JSON.stringify(json.errors))
      }
    }
  }
}

export function startWatcher() {
  const tail = new Tail(LOG_PATH)

  tail.on('line', async (line) => {
    const ip = extractIP(line)
    const path = extractPath(line)

    // Global rate limit (counts all requests from an IP)
    if (recordRateHit(ip, path)) {
      await blockIp(ip, 'rate', null, RATE_LIMIT_ACTION)
      return
    }

    if (is404(line)) {
      if (record404Hit(ip)) {
        await blockIp(ip, '404', null, BLOCK_ACTION)
        return
      }
    }

    if (recordPathHit(ip, path)) {
      await blockIp(ip, 'path', path, PATH_BLOCK_ACTION)
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

    // Clean rate tracker
    for (const [ip, data] of rateTracker.entries()) {
      if (now - data.start > rateIntervalMs) {
        rateTracker.delete(ip)
      }
    }
  }

  tail.on('error', (err) => {
    logger.error('Tail error:', err.message)
  })

  logger.info('VoidGates Watcher is running...')
  setInterval(cleanupTrackers, 30 * 1000) // Run cleanup every 30 seconds
  setInterval(cleanExpiredBlocks, cleanupInterval)
  
  // ✅ Sync whitelist now and every 10 minutes
  syncWhitelist()
  setInterval(syncWhitelist, 10 * 60 * 1000)
}
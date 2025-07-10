import fetch from 'node-fetch'
import { Tail } from 'tail'
import { logger } from './logger.js'

const {
  CF_API_TOKEN,
  CF_ACCOUNT_ID,
  VOIDGATES_ZONE,
  LOG_PATH,
  BLOCK_THRESHOLD = 10,
  BLOCK_INTERVAL_SECONDS = 60,
  BLOCK_DURATION_SECONDS = '',
  CLEANUP_INTERVAL_SECONDS = 300,
  DRY_RUN = 'false',
} = process.env

console.log('apiToken:', CF_API_TOKEN)
console.log('accountId:', CF_ACCOUNT_ID)
console.log('zoneId:', VOIDGATES_ZONE)
console.log('logPath:', LOG_PATH)


const BLOCK_NOTE_PREFIX = 'VoidGates Detection -'
const ipTracker = new Map()
const intervalMs = Number(BLOCK_INTERVAL_SECONDS) * 1000
const cleanupInterval = Number(CLEANUP_INTERVAL_SECONDS) * 1000
const blockDurationMs = Number(BLOCK_DURATION_SECONDS) * 1000

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

function recordHit(ip) {
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

async function blockIp(ip) {
  const timestamp = new Date().toISOString()
  const note = `${BLOCK_NOTE_PREFIX} ${timestamp}`
  // const note = "VoidGates detection – test variant"
  if (DRY_RUN === 'true') {
    logger.info(`[Dry Run] Block triggered for IP: ${ip} @ ${timestamp}`)
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
      logger.info(`Blocked IP: ${ip} @ ${timestamp}`)
      logger.debug(`Cloudflare response: ${JSON.stringify(json)}`)
    } else {
      logger.error('Cloudflare block error:', JSON.stringify(json.errors))
    }
  } catch (err) {
    logger.error('Block request failed:', err.message)
  }

  ipTracker.delete(ip)
}

async function cleanExpiredBlocks() {
  if (!BLOCK_DURATION_SECONDS || isNaN(blockDurationMs)) return

  logger.info(`[Cleanup] Checking for expired blocks...`)
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
        if (
          rule.notes &&
          rule.notes.startsWith(BLOCK_NOTE_PREFIX) &&
          rule.configuration?.target === 'ip'
        ) {
          console.log(rule)
          const timestamp = rule.notes.replace(`${BLOCK_NOTE_PREFIX} `, '').trim()
          const expired = Date.now() - new Date(timestamp).getTime() > blockDurationMs

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
    if (!is404(line)) return
    const ip = extractIP(line)
    if (recordHit(ip)) {
      await blockIp(ip)
    }
  })

  tail.on('error', (err) => {
    logger.error('Tail error:', err.message)
  })

  logger.info('VoidGates Watcher is running...')
  setInterval(cleanExpiredBlocks, cleanupInterval)
}
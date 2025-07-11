// TODO: Reboot bitnami if multiple 504s detected... a .env variable to enable this would be needed
// TODO... figure out passing env with pm2 not working
//PERHAPS:  #!/bin/bash
// export VOIDGATES_ENV_PATH="/home/bitnami/voidgates.env"
// node /home/bitnami/voidgates-watcher/bin/voidgates-watcher.js
// pm2 start start.sh --name voidgates

// TODO: Also perhaps update NOTE with new timestamp intead of saying "already exists"

// TODO: 
// INCLUDE IN README:  

// # Step 1: Install NVM (Node Version Manager)
// curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

// # Step 2: Load NVM into current shell
// export NVM_DIR="$HOME/.nvm"
// source "$NVM_DIR/nvm.sh"

// # Step 3: Install latest LTS version of Node.js (includes npm)
// nvm install --lts

// # Step 4: Install PM2 globally using npm
// npm install -g pm2

// # Step 5: Start your app with PM2 (adjust path as needed)
// pm2 start bin/voidgates-watcher.js --name voidgates

// # Step 6: Enable PM2 to start on system boot
// pm2 startup

// # IMPORTANT: Run the sudo command that the above prints.
// # Example (yours may differ):
// # sudo env PATH=$PATH:/home/bitnami/.nvm/versions/node/vXX.X.X/bin pm2 startup systemd -u bitnami --hp /home/bitnami

// # Step 7: Save the PM2 process list
// pm2 save

//TODO: cleanup icons in console.logs... don't show up in termainal on all platforms
//TODO: make logs show actions ONLY... added who and why... removed and why (404 or Path (if path...what path))... also errors... don't need to see API respones or the "checking..."

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

async function blockIp(ip, type = '404') {
  const timestamp = new Date().toISOString()
  const note = `${type === 'path' ? PATH_BLOCK_NOTE_PREFIX : BLOCK_NOTE_PREFIX} ${timestamp}`

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
      await blockIp(ip, 'path')
    }
  })

  tail.on('error', (err) => {
    logger.error('Tail error:', err.message)
  })

  logger.info('VoidGates Watcher is running...')
  setInterval(cleanExpiredBlocks, cleanupInterval)
}
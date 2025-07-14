#!/usr/bin/env node

// Load initial environment from project root
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const rootEnvPath = path.resolve(process.cwd(), '.env')

// If root .env doesn't exist, run setup
if (!fs.existsSync(rootEnvPath)) {
  console.log(`[INFO] No .env found in project root. Launching setup...\n`)
  const result = spawnSync('node', [path.resolve('./scripts/setup.js')], { stdio: 'inherit' })

  if (result.status !== 0) {
    console.error('[ERROR] Setup failed. Exiting.')
    process.exit(result.status)
  }

  console.log('\n[INFO] Setup complete.')
  console.log('[INFO] Please finish editing your new voidgates.env config file before running again.\n')
  process.exit(0)
}

// Load root .env to get VOIDGATES_ENV_PATH
dotenv.config({ path: rootEnvPath })

const realEnvPath = process.env.VOIDGATES_ENV_PATH

if (!realEnvPath) {
  console.error('[ERROR] VOIDGATES_ENV_PATH is not defined in your root .env file.')
  console.error(`[INFO] Run \`voidgates-watcher setup\` to reconfigure.`)
  process.exit(1)
}

if (!fs.existsSync(realEnvPath)) {
  console.error(`[ERROR] Config file not found at: ${realEnvPath}`)
  console.error(`[INFO] This is the path defined in your root .env file.`)
  console.error(`[INFO] Run \`voidgates-watcher setup\` to recreate the config.`)
  process.exit(1)
}

// Load the actual watcher environment
dotenv.config({ path: realEnvPath })
console.log(`[SUCCESS] Loaded environment from ${realEnvPath}`)

// Optional: handle `setup` command directly
if (process.argv.includes('setup')) {
  const setupScript = path.resolve('./scripts/setup.js')
  const result = spawnSync('node', [setupScript], { stdio: 'inherit' })
  process.exit(result.status)
}

// Launch the watcher
const { startWatcher } = await import('../lib/watcher.js')
startWatcher()
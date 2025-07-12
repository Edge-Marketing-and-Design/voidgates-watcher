#!/usr/bin/env node

// Make sure .env loads before *any* other import
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

// Support: --env ./voidgates.env
const customEnvPath = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1]
const resolvedPath = customEnvPath ? path.resolve(customEnvPath) : path.resolve(process.cwd(), '.env')

// If env file doesn't exist, run setup and exit
if (!fs.existsSync(resolvedPath)) {
  console.log(`[INFO] Environment file not found. Launching setup...\n`)
  const result = spawnSync('node', [path.resolve('./scripts/setup.js')], { stdio: 'inherit' })

  if (result.status !== 0) {
    console.error('[ERROR] Setup failed. Exiting.')
    process.exit(result.status)
  }

  console.log('\n[INFO] Setup complete.')
  console.log('[INFO] Please finish filling out your environment file.')
  console.log('[INFO] Then run the watcher again, making sure to pass the --env flag to your .env file, as noted above.\n')
  process.exit(0)
}

// Load env
dotenv.config({ path: resolvedPath })
process.env.VOIDGATES_ENV_PATH = resolvedPath
console.log(`✅ Loaded environment from ${resolvedPath}`)

// Dynamically import and start the watcher
const { startWatcher } = await import('../lib/watcher.js')
startWatcher()
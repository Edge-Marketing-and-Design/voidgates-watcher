#!/usr/bin/env node

// Make sure .env loads before *any* other import
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

// Support: --env ./voidgates.env
const customEnvPath = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1]
const resolvedPath = customEnvPath ? path.resolve(customEnvPath) : path.resolve(process.cwd(), '.env')

if (fs.existsSync(resolvedPath)) {
  dotenv.config({ path: resolvedPath })

  // 👇 Set the path so logger knows where .env came from
  process.env.VOIDGATES_ENV_PATH = resolvedPath

  console.log(`✅ Loaded environment from ${resolvedPath}`)
} else {
  console.warn(`⚠️  No environment file found at ${resolvedPath}`)
}

// Dynamically import everything else *after* env is loaded
const { startWatcher } = await import('../lib/watcher.js')
startWatcher()
#!/usr/bin/env node

// Make sure .env loads before *any* other import
import dotenv from 'dotenv'
dotenv.config()

// Dynamically import everything else *after* env is loaded
const { startWatcher } = await import('../lib/watcher.js')
startWatcher()
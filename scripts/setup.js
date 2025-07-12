import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import os from 'os'
import inquirer from 'inquirer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const examplePath = path.resolve(__dirname, '.env.example')
const realIpCheckScript = path.resolve(__dirname, 'check-real-ip.js')
const defaultPath = path.join(os.homedir(), 'voidgates.env')

;(async () => {
  const { targetPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'targetPath',
      message: 'Where should the voidgates.env file be created?',
      default: defaultPath,
    },
  ])

  if (fs.existsSync(targetPath)) {
    console.warn(`[WARNING] ${targetPath} already exists — skipping creation.`)
  } else {
    try {
      fs.copyFileSync(examplePath, targetPath)
      console.log(`[SUCCESS] voidgates.env created at ${targetPath}`)
    } catch (err) {
      console.warn(`[ERROR] Failed to copy .env.example to ${targetPath}:`, err.message)
    }
  }

  try {
    execSync(`node ${realIpCheckScript}`, { stdio: 'inherit' })
  } catch (err) {
    console.warn('[WARNING] Real IP config check failed or was skipped.')
  }

  console.log('\n[INFO] To run VoidGates Watcher with your config:')
  console.log(`\n   node $(which voidgates-watcher) --env "${targetPath}"`)

  console.log('\n[INFO] To run it continuously with pm2 (recommended):')
  console.log(`\n   pm2 start $(which voidgates-watcher) --name voidgates -- --env "${targetPath}"\n`)
})()
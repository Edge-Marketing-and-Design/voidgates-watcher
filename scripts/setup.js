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
const rootEnvPath = path.resolve(process.cwd(), '.env')
const defaultTargetPath = path.join(os.homedir(), 'voidgates.env')

function parseEnvWithComments(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
  const entries = []

  let commentBuffer = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || trimmed === '') {
      commentBuffer.push(line)
      continue
    }

    const [key, ...rest] = line.split('=')
    const value = rest.join('=').trim()
    entries.push({
      key: key.trim(),
      defaultValue: value,
      comments: [...commentBuffer],
    })
    commentBuffer = []
  }

  return entries
}

;(async () => {
  const { targetPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'targetPath',
      message: 'Where should the voidgates.env file be created?',
      default: defaultTargetPath,
    },
  ])

  const defaultWhitelistPath = path.join(path.dirname(targetPath), 'voidgates_whitelist.txt')

  const sections = parseEnvWithComments(examplePath)

  const responses = {}

  for (const { key, defaultValue, comments } of sections) {
    const message =
      comments.length > 0
        ? `${comments.map((c) => c.replace(/^# ?/, '')).join('\n')}\n${key}`
        : key

    const { value } = await inquirer.prompt([
      {
        type: 'input',
        name: 'value',
        message,
        default: key === 'WHITELIST_PATH' ? defaultWhitelistPath : defaultValue,
      },
    ])

    responses[key] = value
  }

  const whitelistPath = responses['WHITELIST_PATH']
  if (whitelistPath && !fs.existsSync(whitelistPath)) {
    fs.writeFileSync(whitelistPath, '')
    console.log(`[INFO] Created blank whitelist file at ${whitelistPath}`)
  }

  // Generate the final .env content with comments preserved
  const finalLines = sections.map(({ key, comments }) => {
    const commentLines = comments.length ? comments : []
    const valueLine = `${key}=${responses[key] ?? ''}`
    return [...commentLines, valueLine].join('\n')
  })

  try {
    fs.writeFileSync(targetPath, finalLines.join('\n') + '\n')
    console.log(`[SUCCESS] voidgates.env written to ${targetPath}`)
  } catch (err) {
    console.error(`[ERROR] Failed to write to ${targetPath}: ${err.message}`)
    process.exit(1)
  }

  try {
    fs.writeFileSync(rootEnvPath, `VOIDGATES_ENV_PATH=${targetPath}\n`)
    console.log(`[INFO] Project root .env updated to reference ${targetPath}`)
  } catch (err) {
    console.error(`[ERROR] Failed to write root .env: ${err.message}`)
    process.exit(1)
  }

  try {
    execSync(`node ${realIpCheckScript}`, { stdio: 'inherit' })
  } catch (err) {
    console.warn('[WARNING] Real IP config check failed or was skipped.')
  }

  console.log('\n[INFO] To run VoidGates Watcher:')
  console.log(`\n   voidgates-watcher\n`)

  console.log('[INFO] To run it continuously with pm2 (recommended):')
  console.log(`\n   pm2 start $(which voidgates-watcher) --name voidgates\n`)
})()
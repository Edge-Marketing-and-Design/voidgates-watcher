import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env')
const examplePath = path.resolve(process.cwd(), 'scripts/.env.example')

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath)
    console.log('.env file created from scripts/.env.example ✅')
  } else {
    fs.writeFileSync(envPath, '# TODO: Populate environment variables\n')
    console.warn('scripts/.env.example not found — empty .env file created ⚠️')
  }
} else {
  console.log('.env already exists — skipping copy ✅')
}
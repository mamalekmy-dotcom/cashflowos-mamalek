// Create (or repair) an Owner account from your own terminal. Needed once, because
// the admin panel needs an owner logged in before it can create anyone else.
// Usage:  npm run create-owner -- you@example.com "Your Name" 123456789
// The Telegram ID is optional. You type the password here, and it's never shown.
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env (via --env-file).
import readline from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

const [emailArg, name, telegramArg] = process.argv.slice(2)
const url = process.env.SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!emailArg || !name) {
  console.error('Usage: npm run create-owner -- you@example.com "Your Name" [telegramId]')
  process.exit(1)
}
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.')
  process.exit(1)
}

const email = emailArg.trim().toLowerCase()
const telegram_id = telegramArg ? Number(telegramArg) : null

// Ask for the password without echoing what's typed.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
const write = rl._writeToOutput.bind(rl)
rl._writeToOutput = text => { if (text.includes('Password')) write(text) }
const password = await rl.question('Password for this account (at least 10 characters): ')
rl.close()
console.log('')
if (password.length < 10) {
  console.error('That password is too short. Nothing was changed.')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const { data: existing } = await supabase.from('app_users').select('auth_id').eq('email', email).maybeSingle()
let authId = existing?.auth_id
if (authId) {
  const { error } = await supabase.auth.admin.updateUserById(authId, { password })
  if (error) throw new Error(error.message)
} else {
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  authId = data.user.id
}

const { error } = await supabase.from('app_users').upsert(
  { auth_id: authId, email, name, role: 'owner', telegram_id, active: true, must_change_password: false },
  { onConflict: 'email' },
)
if (error) throw new Error(error.message)
console.log(`✅ ${name} (${email}) is an Owner. Log in at your app.`)

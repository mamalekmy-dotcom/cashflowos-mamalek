import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { supabase, freshAuthClient } from './supabase'

// 🔒 Don't edit — this keeps your robot safe.
// Accounts and sessions. Supabase Auth checks passwords; everything else (role,
// tabs, disabled or not) lives in app_users and is read on every request, so
// disabling someone takes effect on their very next click.
// proxy.ts imports this file, so it can't use next/headers or React. Those live in
// lib/auth.ts.

export const SESSION_COOKIE = 'cfo_user'
export const SESSION_DAYS = 14

export type AppUser = {
  id: number
  auth_id: string | null
  email: string
  name: string
  role: string
  extra_tabs: string[]
  telegram_id: number | null
  active: boolean
  must_change_password: boolean
}

// The cookie holds a random token; only its hash is stored, so a leaked sessions
// table can't be turned back into working cookies.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()
  const { error } = await supabase
    .from('app_sessions')
    .insert({ token_hash: hashToken(token), user_id: userId, expires_at: expires })
  if (error) throw new Error(`could not start a session: ${error.message}`)
  return token
}

// Fails closed: expired, unknown, disabled or a database error all mean "not logged in".
export async function userForToken(token: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('app_sessions')
    .select('app_users(*)')
    .eq('token_hash', hashToken(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    console.error('[CFO] session lookup failed:', error.message)
    return null
  }
  const user = data?.app_users as unknown as AppUser | null | undefined
  return user?.active ? user : null
}

export async function endSession(token: string): Promise<void> {
  await supabase.from('app_sessions').delete().eq('token_hash', hashToken(token))
}

export async function endAllSessions(userId: number): Promise<void> {
  await supabase.from('app_sessions').delete().eq('user_id', userId)
}

// True when this email + password are correct. A throwaway client, because signing
// in on the shared one would swap its service key for this user's token.
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const { error } = await freshAuthClient().auth.signInWithPassword({ email, password })
  return !error
}

export async function userByEmail(email: string): Promise<AppUser | null> {
  const { data } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  return (data as AppUser | null) ?? null
}

// Staff log in with their ID (ML001). Supabase Auth only knows emails, so swap it first.
export async function emailForStaffId(staffNo: string): Promise<string | null> {
  const { data } = await supabase
    .from('hr_people')
    .select('app_users(email)')
    .eq('staff_no', staffNo.trim().toUpperCase())
    .maybeSingle()
  return (data?.app_users as unknown as { email: string } | null)?.email ?? null
}

// ---- Telegram: the same accounts decide who the bot answers. ----

export async function userByTelegramId(id: unknown): Promise<AppUser | null> {
  const telegramId = Number(id)
  if (!Number.isFinite(telegramId)) return null
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) console.error('[CFO] telegram user lookup failed:', error.message)
  return (data as AppUser | null) ?? null
}

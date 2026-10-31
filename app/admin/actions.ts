'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { GRANTABLE_TABS, ROLES } from '@/lib/access'
import { endAllSessions } from '@/lib/session'
import { supabase } from '@/lib/supabase'

// 🔒 Don't edit — this keeps your robot safe.
// Everything the admin panel can change. Each action checks for an owner itself,
// so reaching one directly gets nowhere without the Owner role.

type Result = { ok: boolean; message: string; tempPassword?: string }

const fail = (message: string): Result => ({ ok: false, message })
const tempPassword = () => randomBytes(9).toString('base64url')
const validRole = (role: string) => ROLES.some(r => r.key === role)
const validTabs = (tabs: string[]) => tabs.filter(t => GRANTABLE_TABS.some(g => g.href === t))

function parseTelegramId(raw: string): number | null | undefined {
  const value = raw.trim()
  if (!value) return null
  return /^\d{5,15}$/.test(value) ? Number(value) : undefined
}

// A friendlier message than the database's for the two mistakes people really make.
function saveError(message: string): Result {
  if (/telegram/i.test(message)) return fail('That Telegram ID already belongs to someone.')
  if (/email/i.test(message)) return fail('That email already has an account.')
  return fail(message)
}

async function activeOwnerCount(): Promise<number> {
  const { count } = await supabase
    .from('app_users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'owner')
    .eq('active', true)
  return count ?? 0
}

async function isLastOwner(id: number): Promise<boolean> {
  const { data } = await supabase.from('app_users').select('role, active').eq('id', id).maybeSingle()
  return data?.role === 'owner' && data.active === true && (await activeOwnerCount()) <= 1
}

export async function createUser(input: {
  name: string
  email: string
  role: string
  telegramId: string
}): Promise<Result> {
  await requireOwner()
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const telegramId = parseTelegramId(input.telegramId)
  if (!name) return fail('Add their name.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email doesn't look right.")
  if (!validRole(input.role)) return fail('Choose a role.')
  if (telegramId === undefined) return fail('A Telegram ID is numbers only.')

  const password = tempPassword()
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) return saveError(error?.message ?? 'Could not create the login.')

  const { error: insertError } = await supabase.from('app_users').insert({
    auth_id: data.user.id,
    email,
    name,
    role: input.role,
    telegram_id: telegramId,
  })
  if (insertError) {
    await supabase.auth.admin.deleteUser(data.user.id)
    return saveError(insertError.message)
  }
  revalidatePath('/admin')
  return { ok: true, message: `${name} is set up.`, tempPassword: password }
}

export async function updateUser(
  id: number,
  input: { role: string; extraTabs: string[]; telegramId: string },
): Promise<Result> {
  await requireOwner()
  const telegramId = parseTelegramId(input.telegramId)
  if (!validRole(input.role)) return fail('Choose a role.')
  if (telegramId === undefined) return fail('A Telegram ID is numbers only.')
  if (input.role !== 'owner' && (await isLastOwner(id))) {
    return fail('This is your last owner, so the role has to stay Owner.')
  }
  const { error } = await supabase
    .from('app_users')
    .update({ role: input.role, extra_tabs: validTabs(input.extraTabs), telegram_id: telegramId })
    .eq('id', id)
  if (error) return saveError(error.message)
  revalidatePath('/admin')
  return { ok: true, message: 'Saved.' }
}

// Disabling stops the login and the bot straight away, and keeps all their history.
export async function setActive(id: number, active: boolean): Promise<Result> {
  const me = await requireOwner()
  if (!active && id === me.id) return fail("You can't disable your own account.")
  if (!active && (await isLastOwner(id))) return fail('This is your last owner.')
  const { error } = await supabase.from('app_users').update({ active }).eq('id', id)
  if (error) return fail(error.message)
  if (!active) await endAllSessions(id)
  revalidatePath('/admin')
  return { ok: true, message: active ? 'Enabled.' : 'Disabled. They were logged out.' }
}

export async function resetPassword(id: number): Promise<Result> {
  await requireOwner()
  const { data: user } = await supabase.from('app_users').select('auth_id, name').eq('id', id).maybeSingle()
  if (!user?.auth_id) return fail('This person has no login to reset.')
  const password = tempPassword()
  const { error } = await supabase.auth.admin.updateUserById(user.auth_id, { password })
  if (error) return fail(error.message)
  await supabase.from('app_users').update({ must_change_password: true }).eq('id', id)
  await endAllSessions(id)
  return { ok: true, message: `New temporary password for ${user.name}.`, tempPassword: password }
}

'use server'

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

const PIN_COOKIE = 'cfo_docs'
const SALT_KEY = 'doc_pin'
const hash = (pin: string, salt: string) => createHash('sha256').update(`${salt}:${pin}`).digest('hex')

async function savedPin(): Promise<{ salt: string; hash: string } | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', SALT_KEY).maybeSingle()
  return (data?.value as { salt: string; hash: string } | undefined) ?? null
}

// The cabinet stays locked for an hour after the PIN, on this device only. The cookie
// is tied to the PIN, so changing the PIN locks every device out.
async function grant(pinHash: string) {
  const jar = await cookies()
  jar.set(PIN_COOKIE, pinHash, { httpOnly: true, secure: true, sameSite: 'lax', path: '/docs', maxAge: 3600 })
}

export async function isUnlocked(): Promise<boolean> {
  const saved = await savedPin()
  const cookie = (await cookies()).get(PIN_COOKIE)?.value
  if (!saved || !cookie || cookie.length !== saved.hash.length) return false
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(saved.hash))
}

export async function hasPin(): Promise<boolean> {
  return (await savedPin()) !== null
}

export async function enterPin(pin: string): Promise<Result> {
  await requireOwner()
  if (!/^\d{4}$/.test(pin)) return { ok: false, message: 'Enter 4 digits.' }
  const saved = await savedPin()
  if (!saved) {
    const salt = randomBytes(16).toString('hex')
    const value = { salt, hash: hash(pin, salt) }
    const { error } = await supabase.from('app_settings').insert({ key: SALT_KEY, value })
    if (error) return { ok: false, message: error.message }
    await grant(value.hash)
    return { ok: true, message: 'PIN set.' }
  }
  if (hash(pin, saved.salt) !== saved.hash) return { ok: false, message: 'Wrong PIN.' }
  await grant(saved.hash)
  return { ok: true, message: 'Unlocked.' }
}

async function requireCabinet() {
  const user = await requireOwner()
  if (!(await isUnlocked())) throw new Error('Doc Center is locked.')
  return user
}

// Accepting is what turns a scan into a cost. The amount and date come from the owner's
// form, since the robot's reading may be wrong.
export async function acceptDocument(
  id: number,
  input: { amount: number; date: string; category: string; merchant: string },
): Promise<Result> {
  const user = await requireCabinet()
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, message: 'Enter the amount.' }
  if (!['food', 'labor', 'rent', 'other'].includes(input.category)) return { ok: false, message: 'Pick a category.' }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayISO()

  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'accepted', amount: input.amount, doc_date: date, merchant: input.merchant.trim() || null })
    .eq('id', id)
    .eq('status', 'new')
    .select('id')
  if (error) return { ok: false, message: error.message }
  if (!data?.length) return { ok: false, message: 'Already handled.' }

  const { error: costError } = await supabase.from('cost_entries').insert({
    entry_date: date,
    category: input.category,
    amount: input.amount,
    note: input.merchant.trim() || `Document #${id}`,
    created_by: user.id,
  })
  if (costError) {
    await supabase.from('documents').update({ status: 'new' }).eq('id', id)
    return { ok: false, message: costError.message }
  }
  revalidatePath('/docs')
  revalidatePath('/pulse')
  revalidatePath('/suppliers')
  return { ok: true, message: 'Accepted and added to costs.' }
}

export async function rejectDocument(id: number): Promise<Result> {
  await requireCabinet()
  const { error } = await supabase.from('documents').update({ status: 'rejected' }).eq('id', id).eq('status', 'new')
  if (error) return { ok: false, message: error.message }
  revalidatePath('/docs')
  return { ok: true, message: 'Rejected.' }
}

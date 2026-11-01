'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { accessLevel } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

const MAX_PHOTO_BYTES = 8 * 1024 * 1024

const fail = (message: string): Result => ({ ok: false, message })
const validDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayISO()

// Reached from the Daily Report page only, but each action checks again.
async function editor() {
  const user = await getCurrentUser()
  return user && accessLevel(user, '/report') === 'edit' ? user : null
}

export async function saveSales(day: string, input: { cash: number; qr: number; card: number }): Promise<Result> {
  const user = await editor()
  if (!user) return fail('You do not have access to this.')
  if (!validDay(day)) return fail('Pick today or an earlier day.')
  if (![input.cash, input.qr, input.card].every(n => Number.isFinite(n) && n >= 0)) return fail('Enter amounts as numbers.')
  const { error } = await supabase.from('daily_reports').upsert({
    report_date: day, cash: input.cash, qr: input.qr, card: input.card,
    updated_by: user.id, updated_at: new Date().toISOString(),
  })
  if (error) return fail(error.message)
  revalidatePath('/report')
  return { ok: true, message: 'Sales saved.' }
}

// The photo is checked here too, so a purchase can never be saved without one.
export async function addPurchase(form: FormData): Promise<Result> {
  const user = await editor()
  if (!user) return fail('You do not have access to this.')
  const day = String(form.get('day') ?? '')
  const supplier = String(form.get('supplier') ?? '').trim()
  const amount = Number(form.get('amount'))
  const note = String(form.get('note') ?? '').trim()
  const photo = form.get('photo')
  if (!validDay(day)) return fail('Pick today or an earlier day.')
  if (!supplier) return fail('Enter the supplier.')
  if (!Number.isFinite(amount) || amount <= 0) return fail('Enter the amount.')
  if (!(photo instanceof File) || photo.size === 0 || !photo.type.startsWith('image/')) return fail('Add a photo of the invoice.')
  if (photo.size > MAX_PHOTO_BYTES) return fail('That photo is too big. The limit is 8 MB.')

  const path = `purchases/${randomUUID()}`
  const { error: uploadError } = await supabase.storage.from('vault').upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type })
  if (uploadError) return fail('The photo did not upload. Try again.')
  const { error } = await supabase.from('daily_purchases').insert({
    purchase_date: day, supplier, amount, note: note || null, photo_path: path, created_by: user.id,
  })
  if (error) {
    await supabase.storage.from('vault').remove([path])
    return fail(error.message)
  }
  revalidatePath('/report')
  return { ok: true, message: 'Purchase added.' }
}

export async function removePurchase(id: number): Promise<Result> {
  if (!(await editor())) return fail('You do not have access to this.')
  const { data, error } = await supabase.from('daily_purchases').delete().eq('id', id).select('photo_path').maybeSingle()
  if (error) return fail(error.message)
  if (data?.photo_path) await supabase.storage.from('vault').remove([data.photo_path])
  revalidatePath('/report')
  return { ok: true, message: 'Removed.' }
}

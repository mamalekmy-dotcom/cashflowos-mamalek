'use server'

import { revalidatePath } from 'next/cache'
import { accessLevel } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

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

export async function addPurchase(day: string, supplier: string, amount: number, note: string): Promise<Result> {
  const user = await editor()
  if (!user) return fail('You do not have access to this.')
  if (!validDay(day)) return fail('Pick today or an earlier day.')
  if (!supplier.trim()) return fail('Enter the supplier.')
  if (!Number.isFinite(amount) || amount <= 0) return fail('Enter the amount.')
  const { error } = await supabase.from('daily_purchases').insert({
    purchase_date: day, supplier: supplier.trim(), amount, note: note.trim() || null, created_by: user.id,
  })
  if (error) return fail(error.message)
  revalidatePath('/report')
  return { ok: true, message: 'Purchase added.' }
}

export async function removePurchase(id: number): Promise<Result> {
  if (!(await editor())) return fail('You do not have access to this.')
  const { error } = await supabase.from('daily_purchases').delete().eq('id', id)
  if (error) return fail(error.message)
  revalidatePath('/report')
  return { ok: true, message: 'Removed.' }
}

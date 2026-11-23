'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }
export type SubInput = {
  id?: number
  name: string
  amount: number
  currency: string
  cycle: string
  next_renewal: string
  where_invoice: string
  notes: string
  active: boolean
}

export async function saveSubscription(input: SubInput): Promise<Result> {
  await requireOwner()
  const name = input.name.trim()
  if (!name) return { ok: false, message: 'Type a name.' }
  if (!Number.isFinite(input.amount) || input.amount < 0) return { ok: false, message: 'The amount must be a number.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.next_renewal)) return { ok: false, message: 'Pick the next renewal date.' }
  if (!['monthly', 'yearly', 'once'].includes(input.cycle)) return { ok: false, message: 'Pick monthly, yearly or one-off.' }
  const row = {
    name, amount: input.amount, currency: (input.currency || 'MYR').trim().toUpperCase().slice(0, 3),
    cycle: input.cycle, next_renewal: input.next_renewal, where_invoice: input.where_invoice.trim() || null,
    notes: input.notes.trim() || null, active: input.active, updated_at: new Date().toISOString(),
  }
  const { data: old } = input.id
    ? await supabase.from('subscriptions').select('next_renewal').eq('id', input.id).maybeSingle()
    : { data: null }
  // A new renewal date starts its reminders afresh.
  const reset = !old || old.next_renewal !== input.next_renewal ? { reminded: [] as string[] } : {}
  const { error } = input.id
    ? await supabase.from('subscriptions').update({ ...row, ...reset }).eq('id', input.id)
    : await supabase.from('subscriptions').insert({ ...row, reminded: [] })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/subscriptions')
  return { ok: true, message: `${name} saved.` }
}

export async function deleteSubscription(id: number): Promise<Result> {
  await requireOwner()
  const { error } = await supabase.from('subscriptions').delete().eq('id', id)
  if (error) return { ok: false, message: error.message }
  revalidatePath('/subscriptions')
  return { ok: true, message: 'Removed.' }
}

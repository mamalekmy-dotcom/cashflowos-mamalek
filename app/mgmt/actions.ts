'use server'

import { revalidatePath } from 'next/cache'
import { accessLevel } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth'
import { categoryNamed } from '@/lib/expenses'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

async function editor() {
  const user = await getCurrentUser()
  return user && accessLevel(user, '/mgmt') === 'edit' ? user : null
}

// The month's fixed costs keyed in by hand, one amount per category.
export async function saveMonthExpenses(month: string, amounts: { id: number; amount: number }[]): Promise<Result> {
  const user = await editor()
  if (!user) return { ok: false, message: 'You do not have access to this.' }
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: 'Pick a month.' }
  if (amounts.some(a => !Number.isFinite(a.amount) || a.amount < 0)) return { ok: false, message: 'Amounts must be numbers.' }
  const now = new Date().toISOString()
  const keep = amounts.filter(a => a.amount > 0)
  const drop = amounts.filter(a => a.amount === 0).map(a => a.id)
  if (keep.length) {
    const { error } = await supabase.from('monthly_expenses').upsert(
      keep.map(a => ({ month, category_id: a.id, amount: a.amount, updated_by: user.id, updated_at: now })),
    )
    if (error) return { ok: false, message: error.message }
  }
  if (drop.length) await supabase.from('monthly_expenses').delete().eq('month', month).in('category_id', drop)
  revalidatePath('/mgmt')
  return { ok: true, message: 'Saved.' }
}

export async function addCategory(name: string): Promise<Result> {
  if (!(await editor())) return { ok: false, message: 'You do not have access to this.' }
  const cat = await categoryNamed(name)
  if (!cat) return { ok: false, message: 'Type a name.' }
  revalidatePath('/mgmt')
  return { ok: true, message: `${cat.name} added.` }
}

// Rewrites the Google Sheet copy now, instead of waiting for the morning.
export async function refreshSheet(): Promise<Result> {
  if (!(await editor())) return { ok: false, message: 'You do not have access to this.' }
  const { pushMgmtSheet } = await import('@/lib/mgmt')
  const { todayISO } = await import('@/lib/records')
  try {
    const res = await pushMgmtSheet(todayISO())
    return { ok: true, message: `Google Sheet updated: ${res.months} months.` }
  } catch (e: any) {
    return { ok: false, message: `Could not update the Google Sheet: ${e?.message || e}` }
  }
}

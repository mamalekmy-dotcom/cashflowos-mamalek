'use server'

import { revalidatePath } from 'next/cache'
import { accessLevel } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth'
import { syncStockSheet } from '@/lib/stock-import'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

async function editor() {
  const user = await getCurrentUser()
  return user && accessLevel(user, '/cogs') === 'edit' ? user : null
}

// Once the month-end stock count is in the sheet, COGS for that month is final.
export async function markClosed(month: string, closed: boolean): Promise<Result> {
  const user = await editor()
  if (!user) return { ok: false, message: 'You do not have access to this.' }
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: 'Pick a month.' }
  const { error } = closed
    ? await supabase.from('stock_closed').upsert({ month, closed_by: user.id, closed_at: new Date().toISOString() })
    : await supabase.from('stock_closed').delete().eq('month', month)
  if (error) return { ok: false, message: error.message }
  revalidatePath('/cogs')
  return { ok: true, message: closed ? 'Marked as counted.' : 'Unmarked.' }
}

// The same refresh the morning run does, for right after the stock count.
export async function refreshFromSheet(): Promise<Result> {
  if (!(await editor())) return { ok: false, message: 'You do not have access to this.' }
  try {
    const { saved, skipped } = await syncStockSheet()
    revalidatePath('/cogs')
    return { ok: true, message: `Read Stock 2026: ${saved.length} months updated.${skipped.length ? ` Skipped ${skipped.join(', ')} (totals don't add up in the sheet).` : ''}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Reading Stock 2026 failed.' }
  }
}

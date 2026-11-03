'use server'

import { revalidatePath } from 'next/cache'
import { accessLevel } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

// Reached from the FLR Report page only, but the action checks again.
export async function saveMonthCosts(month: string, labour: number, rent: number): Promise<Result> {
  const user = await getCurrentUser()
  if (!user || accessLevel(user, '/flr') !== 'edit') return { ok: false, message: 'You do not have access to this.' }
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: 'Pick a month.' }
  if (!Number.isFinite(labour) || labour < 0) return { ok: false, message: 'Labour cost must be a number.' }
  if (!Number.isFinite(rent) || rent < 0) return { ok: false, message: 'Rental cost must be a number.' }
  const { error } = await supabase.from('monthly_costs').upsert({
    month, labour, rent, updated_by: user.id, updated_at: new Date().toISOString(),
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/flr')
  return { ok: true, message: 'Saved.' }
}

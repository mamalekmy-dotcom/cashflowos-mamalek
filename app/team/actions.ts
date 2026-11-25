'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
const isTime = (t: string) => /^\d{2}:\d{2}$/.test(t)

export async function setShift(userId: number, day: string, code: string): Promise<Result> {
  await requireOwner()
  if (!isDate(day)) return { ok: false, message: 'Pick a day.' }
  const { error } = code
    ? await supabase.from('roster').upsert({ user_id: userId, work_date: day, shift_code: code })
    : await supabase.from('roster').delete().eq('user_id', userId).eq('work_date', day)
  if (error) return { ok: false, message: error.message }
  revalidatePath('/team')
  return { ok: true, message: 'Saved.' }
}

export async function decideOvertime(id: number, approve: boolean): Promise<Result> {
  const owner = await requireOwner()
  const { error } = await supabase
    .from('ot_requests')
    .update({ status: approve ? 'approved' : 'denied', decided_by: owner.id })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) return { ok: false, message: error.message }
  revalidatePath('/team')
  return { ok: true, message: approve ? 'Approved.' : 'Denied.' }
}

// A shift: one block with an optional break (e.g. 60 min), or a split shift with a
// second block (lunch and dinner); then the break is the gap between the blocks.
export async function saveShiftType(code: string, start: string, end: string, breakMinutes = 0, start2 = '', end2 = ''): Promise<Result> {
  await requireOwner()
  const clean = code.trim().toUpperCase()
  if (!clean) return { ok: false, message: 'Give the shift a short code.' }
  if (!isTime(start) || !isTime(end)) return { ok: false, message: 'Set the start and end time.' }
  const split = Boolean(start2 || end2)
  if (split && (!isTime(start2) || !isTime(end2))) return { ok: false, message: 'Set both times of the second block, or leave both empty.' }
  if (split && start2 <= end) return { ok: false, message: 'The second block must start after the first one ends.' }
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 600) return { ok: false, message: 'Break is in minutes, 0 to 600.' }
  const { error } = await supabase.from('shift_types').upsert({
    code: clean, start_time: start, end_time: end, break_minutes: split ? 0 : Math.round(breakMinutes),
    start2: split ? start2 : null, end2: split ? end2 : null,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/team')
  return { ok: true, message: 'Shift saved.' }
}

export async function saveShopPin(lat: number, lng: number, radius: number): Promise<Result> {
  await requireOwner()
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, message: 'Those coordinates look wrong.' }
  }
  if (!Number.isFinite(radius) || radius < 10) return { ok: false, message: 'Use a radius of at least 10 metres.' }
  const { error } = await supabase.from('app_settings').upsert({ key: 'shop_pin', value: { lat, lng, radius } })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/team')
  return { ok: true, message: 'Shop pin saved.' }
}

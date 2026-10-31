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

export async function saveShiftType(code: string, start: string, end: string): Promise<Result> {
  await requireOwner()
  const clean = code.trim().toUpperCase()
  if (!clean) return { ok: false, message: 'Give the shift a short code.' }
  if (!isTime(start) || !isTime(end)) return { ok: false, message: 'Set the start and end time.' }
  const { error } = await supabase.from('shift_types').upsert({ code: clean, start_time: start, end_time: end })
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

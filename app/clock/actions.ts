'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { distanceMetres, overtimeHours } from '@/lib/attendance'
import { getCurrentUser } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

const MAX_PHOTO_BYTES = 8 * 1024 * 1024

// The server sets the punch time, so a phone's clock can't change someone's hours.
// Clocking in needs a selfie and a location, checked here so a stale page can't skip
// them. Clocking out needs neither: staff shouldn't get stuck on shift over a bad signal.
export async function punch(form: FormData): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: 'Please log in again.' }
  const kind = form.get('kind')
  if (kind !== 'in' && kind !== 'out') return { ok: false, message: 'Choose clock in or out.' }

  const lat = Number(form.get('lat'))
  const lng = Number(form.get('lng'))
  const hasGps = form.get('lat') !== null && Number.isFinite(lat) && Number.isFinite(lng)
  const photo = form.get('photo')
  const hasPhoto = photo instanceof File && photo.size > 0 && photo.size <= MAX_PHOTO_BYTES && photo.type.startsWith('image/')
  if (kind === 'in' && !hasGps) return { ok: false, message: 'We need your location to clock you in. Turn on location and try again.' }
  if (kind === 'in' && !hasPhoto) return { ok: false, message: 'Take a selfie first.' }

  const { data: pinRow } = await supabase.from('app_settings').select('value').eq('key', 'shop_pin').maybeSingle()
  const pin = pinRow?.value as { lat: number; lng: number } | undefined

  let photo_path: string | null = null
  if (hasPhoto) {
    const path = `punches/${randomUUID()}`
    const { error } = await supabase.storage.from('vault').upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type })
    if (error && kind === 'in') return { ok: false, message: 'Your selfie did not upload. Try again.' }
    if (!error) photo_path = path
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('punches').insert({
    user_id: user.id,
    kind,
    punched_at: now,
    lat: hasGps ? lat : null,
    lng: hasGps ? lng : null,
    distance_m: hasGps && pin ? distanceMetres(lat, lng, pin.lat, pin.lng) : null,
    photo_path,
  })
  if (error) return { ok: false, message: error.message }

  if (kind === 'out') await raiseOvertime(user.id, now)
  revalidatePath('/clock')
  revalidatePath('/team/history')
  return { ok: true, message: kind === 'in' ? 'Clocked in.' : 'Clocked out.' }
}

async function raiseOvertime(userId: number, clockOut: string) {
  const day = todayISO()
  const { data } = await supabase
    .from('roster')
    .select('shift_types(end_time)')
    .eq('user_id', userId)
    .eq('work_date', day)
    .maybeSingle()
  const shift = data?.shift_types as unknown as { end_time: string } | null | undefined
  if (!shift) return
  const hours = overtimeHours(clockOut, shift.end_time)
  if (hours > 0) {
    await supabase.from('ot_requests').upsert({ user_id: userId, work_date: day, hours }, { onConflict: 'user_id,work_date', ignoreDuplicates: true })
  }
}

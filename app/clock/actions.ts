'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { distanceMetres, overtimeHours } from '@/lib/attendance'
import { getCurrentUser } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { ownerChats, tellOwners } from '@/lib/notify'
import { sendWithButtons } from '@/lib/telegram'
import {
  BREAK_GRACE_MIN, GOOD_ACCURACY_M, allowed, breakAllowance, lateMinutes, stateOf, timeText, type Kind, type Shift,
} from '@/lib/clock'

type Result = { ok: boolean; message: string; code?: string }

const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const PHOTO_MAX_AGE_MS = 3 * 60_000
const KINDS: Kind[] = ['in', 'out', 'break_out', 'break_in']
const fail = (code: string, message: string): Result => ({ ok: false, code, message })

function photoOf(form: FormData, key: string): File | null {
  const f = form.get(key)
  return f instanceof File && f.size > 0 && f.size <= MAX_PHOTO_BYTES && f.type.startsWith('image/') ? f : null
}

async function upload(file: File): Promise<string | null> {
  const path = `punches/${randomUUID()}`
  const { error } = await supabase.storage.from('vault').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type })
  return error ? null : path
}

// One phone per staff. The first phone is approved by itself; any other waits for an
// owner (Telegram buttons or the Attendance tab). Returns null when this phone may punch.
async function phoneProblem(userId: number, name: string, deviceId: string, label: string): Promise<Result | null> {
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(deviceId)) return fail('device_missing', 'This phone could not be identified. Reload the page and try again.')
  const { data: devices } = await supabase.from('staff_devices').select('id, device_id, status').eq('user_id', userId)
  const mine = (devices ?? []).find(d => d.device_id === deviceId)
  if (mine?.status === 'approved') return null
  if (!(devices ?? []).some(d => d.status === 'approved')) {
    // First phone for this person: register it.
    await supabase.from('staff_devices').upsert({ user_id: userId, device_id: deviceId, label, status: 'approved', decided_at: new Date().toISOString() }, { onConflict: 'user_id,device_id' })
    return null
  }
  if (mine?.status === 'rejected') return fail('device_rejected', 'This phone was not approved for your account. Use your registered phone, or ask the owner.')
  if (!mine) {
    const { data: row } = await supabase.from('staff_devices').insert({ user_id: userId, device_id: deviceId, label, status: 'pending' }).select('id').single()
    if (row) {
      const text = `📱 <b>${name}</b> wants to clock in on a <b>new phone</b> (${label}).\nApprove it as their phone? Their old phone stops working.`
      for (const chat of await ownerChats()) {
        await sendWithButtons(Number(chat), text, [[{ text: '✅ Approve phone', callback_data: `dev:${row.id}:a` }, { text: '❌ Reject', callback_data: `dev:${row.id}:r` }]]).catch(() => {})
      }
    }
  }
  return fail('device_pending', 'This is a new phone for your account, so the owner must approve it first. They have been told. Try again after they approve.')
}

// Clock in / out and breaks. The server sets the time. Clock-in and back-from-break need
// a selfie and a shop photo taken just now, this phone, and a location: inside the shop
// radius, or no usable GPS (allowed, flagged). Clock-out and start-break need neither, so
// nobody is stuck on shift over a bad signal.
export async function punch(form: FormData): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return fail('unauthorized', 'Please log in again.')
  const kind = String(form.get('kind')) as Kind
  if (!KINDS.includes(kind)) return fail('bad_kind', 'Choose clock in or out.')

  // Where they are now decides what they can do.
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString()
  const { data: recent } = await supabase.from('punches').select('kind, punched_at').eq('user_id', user.id).gte('punched_at', since).order('punched_at')
  const now = stateOf(recent ?? [])
  if (!allowed[now.state].includes(kind)) {
    const msg = now.state === 'off' ? 'You are not clocked in yet.' : now.state === 'break' ? 'You are on break. End your break first.' : 'You are already clocked in.'
    return fail('wrong_state', `${msg} Refresh to see the latest status.`)
  }

  const needsProof = kind === 'in' || kind === 'break_in'
  const deviceId = String(form.get('device') || '')
  const label = String(form.get('deviceLabel') || 'phone').slice(0, 80)
  if (needsProof) {
    const phone = await phoneProblem(user.id, user.name, deviceId, label)
    if (phone) return phone
  }

  const selfie = photoOf(form, 'photo')
  const shop = photoOf(form, 'shopPhoto')
  if (needsProof) {
    if (!selfie) return fail('photo_missing', 'Take a selfie first.')
    if (!shop) return fail('shop_missing', 'Take a photo of the shop too.')
    const takenAt = Number(form.get('takenAt'))
    if (!Number.isFinite(takenAt) || Date.now() - takenAt > PHOTO_MAX_AGE_MS || takenAt - Date.now() > 60_000) {
      return fail('photo_expired', 'Those photos are too old. Take fresh ones.')
    }
  }

  const lat = Number(form.get('lat'))
  const lng = Number(form.get('lng'))
  const acc = Number(form.get('accuracy'))
  const hasGps = form.get('lat') !== null && Number.isFinite(lat) && Number.isFinite(lng)
  const goodGps = hasGps && Number.isFinite(acc) && acc <= GOOD_ACCURACY_M
  const { data: pinRow } = await supabase.from('app_settings').select('value').eq('key', 'shop_pin').maybeSingle()
  const pin = pinRow?.value as { lat: number; lng: number; radius?: number } | undefined
  const away = hasGps && pin ? distanceMetres(lat, lng, pin.lat, pin.lng) : null
  if (needsProof && goodGps && pin && away !== null) {
    const limit = Number(pin.radius) || 80
    if (away > limit) {
      const far = away >= 1000 ? `${(away / 1000).toFixed(1)} km` : `${away} m`
      return fail('outside_radius', `You're ${far} from the shop (limit ${limit} m). Move closer and try again.`)
    }
  }

  // Flags for the manager board.
  const flags: string[] = []
  const at = new Date().toISOString()
  const day = todayISO()
  const { data: rosterRow } = await supabase.from('roster').select('shift_types(code, start_time, end_time, break_minutes, start2, end2)')
    .eq('user_id', user.id).eq('work_date', day).maybeSingle()
  const shift = (rosterRow?.shift_types as unknown as Shift | null) ?? null
  if (needsProof && !goodGps) flags.push('no_gps')
  if (kind === 'in') {
    if (!shift) flags.push('off_roster')
    else if (lateMinutes(at, shift) > 0) flags.push('late')
  }
  let lateBreakBy = 0
  if (kind === 'break_in' && now.since) {
    const took = Math.round((Date.parse(at) - Date.parse(now.since)) / 60_000)
    const allow = breakAllowance(shift)
    if (allow > 0 && took > allow + BREAK_GRACE_MIN) { flags.push('late_break'); lateBreakBy = took - allow }
  }

  const [photo_path, shop_photo_path] = await Promise.all([selfie ? upload(selfie) : null, shop ? upload(shop) : null])
  if (needsProof && (!photo_path || !shop_photo_path)) return fail('photo_not_found', 'The photos did not upload. Check your connection and try again.')

  const { error } = await supabase.from('punches').insert({
    user_id: user.id, kind, punched_at: at,
    lat: hasGps ? lat : null, lng: hasGps ? lng : null, accuracy_m: Number.isFinite(acc) ? Math.round(acc) : null,
    distance_m: away, photo_path, shop_photo_path, device_id: deviceId || null, flags,
  })
  if (error) return fail('punch_failed', 'The punch could not be saved. Try again in a moment.')

  if (lateBreakBy) {
    await tellOwners(`⏰ <b>${user.name}</b> came back from break <b>${lateBreakBy} min</b> late (break ${breakAllowance(shift)} min, back at ${timeText(at)}).`).catch(() => {})
  }
  if (kind === 'out') await raiseOvertime(user.id, at, shift)
  revalidatePath('/clock')
  revalidatePath('/')
  const words: Record<Kind, string> = { in: 'Clocked in', out: 'Clocked out', break_out: 'Break started', break_in: 'Back from break' }
  return { ok: true, message: `${words[kind]} at ${timeText(at)}.${flags.includes('late') ? ' Marked late.' : ''}${flags.includes('no_gps') ? ' No GPS fix, so this one is marked for the manager to check.' : ''}` }
}

async function raiseOvertime(userId: number, clockOut: string, shift: Shift | null) {
  const end = shift?.end2 || shift?.end_time
  if (!end) return
  const hours = overtimeHours(clockOut, end)
  if (hours > 0) {
    await supabase.from('ot_requests').upsert({ user_id: userId, work_date: todayISO(), hours }, { onConflict: 'user_id,work_date', ignoreDuplicates: true })
  }
}

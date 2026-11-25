import 'server-only'
import { supabase } from './supabase'
import { LATE_GRACE_MIN, breakAllowance, dayOfIso, minutesOfDay, stateOf, workedMinutes, type Shift } from './clock'

// The owners' Attendance tab: today's board (who's in, on break, late, missing), phones
// waiting for approval, and the month's punch report per person.

const TZ_OFFSET = '+08:00'
const hhmm = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

type PunchRow = { id: number; user_id: number; kind: string; punched_at: string; flags: string[] | null; photo_path: string | null; shop_photo_path: string | null; distance_m: number | null }

export type BoardRow = {
  userId: number; name: string; shift: Shift | null
  status: 'missing' | 'not_yet' | 'in' | 'break' | 'out' | 'off' | 'absent'
  since: string | null; worked: number; flags: string[]
  selfie: string | null; shop: string | null; overBreak: boolean
}

async function signed(paths: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (!paths.length) return m
  const { data } = await supabase.storage.from('vault').createSignedUrls(paths, 3600)
  for (const s of data ?? []) if (s.path && s.signedUrl) m.set(s.path, s.signedUrl)
  return m
}

export async function todayBoard(day: string) {
  const nowIso = new Date().toISOString()
  const [{ data: users }, { data: roster }, { data: punches }, { data: marks }, { data: devices }] = await Promise.all([
    supabase.from('app_users').select('id, name, role').eq('active', true).neq('role', 'owner').order('name'),
    supabase.from('roster').select('user_id, shift_types(code, start_time, end_time, break_minutes, start2, end2)').eq('work_date', day),
    supabase.from('punches').select('id, user_id, kind, punched_at, flags, photo_path, shop_photo_path, distance_m')
      .gte('punched_at', `${day}T00:00:00${TZ_OFFSET}`).lte('punched_at', `${day}T23:59:59${TZ_OFFSET}`).order('punched_at'),
    supabase.from('attendance_marks').select('user_id, kind').eq('work_date', day),
    supabase.from('staff_devices').select('id, user_id, label, created_at, app_users!staff_devices_user_id_fkey(name)').eq('status', 'pending').order('created_at'),
  ])
  const ps = (punches ?? []) as PunchRow[]
  const latestProof = new Map<number, PunchRow>()
  for (const p of ps) if (p.kind === 'in' || p.kind === 'break_in') latestProof.set(p.user_id, p)
  const urls = await signed([...latestProof.values()].flatMap(p => [p.photo_path, p.shop_photo_path].filter(Boolean) as string[]))
  const isToday = day === dayOfIso(nowIso)
  const nowMin = minutesOfDay(nowIso)

  const rows: BoardRow[] = (users ?? []).map(u => {
    const shift = ((roster ?? []).find(r => r.user_id === u.id)?.shift_types as unknown as Shift) ?? null
    const mine = ps.filter(p => p.user_id === u.id)
    const st = stateOf(mine)
    const flags = [...new Set(mine.flatMap(p => p.flags ?? []))]
    const proof = latestProof.get(u.id)
    const absent = (marks ?? []).some(m => m.user_id === u.id && m.kind === 'absent')
    let status: BoardRow['status']
    if (absent) status = 'absent'
    else if (mine.length) status = st.state === 'on' ? 'in' : st.state === 'break' ? 'break' : 'out'
    else if (!shift) status = 'off'
    else if (!isToday || nowMin > hhmm(shift.start_time) + LATE_GRACE_MIN) status = 'missing'
    else status = 'not_yet'
    const allow = breakAllowance(shift)
    return {
      userId: u.id, name: u.name, shift, status, since: st.since, flags,
      worked: workedMinutes(mine, isToday && st.state === 'on' ? nowIso : undefined),
      selfie: proof?.photo_path ? urls.get(proof.photo_path) ?? null : null,
      shop: proof?.shop_photo_path ? urls.get(proof.shop_photo_path) ?? null : null,
      overBreak: st.state === 'break' && allow > 0 && !!st.since && Date.now() - Date.parse(st.since) > (allow + 10) * 60_000,
    }
  })
  const order: Record<BoardRow['status'], number> = { missing: 0, break: 1, in: 2, not_yet: 3, out: 4, absent: 5, off: 6 }
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
  return {
    rows,
    devices: (devices ?? []).map(d => ({ id: d.id, name: (d.app_users as any)?.name ?? `#${d.user_id}`, label: d.label, at: d.created_at })),
    staff: (users ?? []).map(u => ({ id: u.id, name: u.name })),
  }
}

export type MonthRow = {
  userId: number; name: string; days: number; minutes: number
  late: number; lateBreak: number; noGps: number; offRoster: number; missingOut: number; absent: number
}

export async function monthReport(month: string) {
  const [y, m] = month.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  const [{ data: users }, { data: punches }, { data: marks }] = await Promise.all([
    supabase.from('app_users').select('id, name, role').eq('active', true).neq('role', 'owner').order('name'),
    supabase.from('punches').select('id, user_id, kind, punched_at, flags, distance_m, photo_path, shop_photo_path')
      .gte('punched_at', `${month}-01T00:00:00${TZ_OFFSET}`).lt('punched_at', `${next}-01T00:00:00${TZ_OFFSET}`).order('punched_at'),
    supabase.from('attendance_marks').select('user_id, work_date, kind').gte('work_date', `${month}-01`).lt('work_date', `${next}-01`),
  ])
  const ps = (punches ?? []) as PunchRow[]
  const rows: MonthRow[] = (users ?? []).map(u => {
    const mine = ps.filter(p => p.user_id === u.id)
    const byDay = new Map<string, PunchRow[]>()
    for (const p of mine) byDay.set(dayOfIso(p.punched_at), [...(byDay.get(dayOfIso(p.punched_at)) ?? []), p])
    const count = (f: string) => mine.filter(p => (p.flags ?? []).includes(f)).length
    return {
      userId: u.id, name: u.name, days: byDay.size,
      minutes: [...byDay.values()].reduce((s, d) => s + workedMinutes(d), 0),
      late: count('late'), lateBreak: count('late_break'), noGps: count('no_gps'), offRoster: count('off_roster'),
      missingOut: [...byDay.entries()].filter(([d, list]) => d < dayOfIso(new Date().toISOString()) && stateOf(list).state !== 'off').length,
      absent: (marks ?? []).filter(x => x.user_id === u.id).length,
    }
  })
  return { rows, punches: ps, names: new Map((users ?? []).map(u => [u.id, u.name])) }
}

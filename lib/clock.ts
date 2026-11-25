// Clock-in rules shared by the staff screen, the server action and the Attendance tab.
// Plain data in, plain data out.

const TZ = 'Asia/Kuala_Lumpur'
export const LATE_GRACE_MIN = 10     // late in: more than 10 min after shift start
export const BREAK_GRACE_MIN = 10    // late from break: break length + 10 min
export const GOOD_ACCURACY_M = 100   // a reading worse than this counts as "no GPS"

export type Kind = 'in' | 'out' | 'break_out' | 'break_in'
export type State = 'off' | 'on' | 'break'
export type PunchLite = { kind: string; punched_at: string }
export type Shift = { code: string; start_time: string; end_time: string; break_minutes: number; start2: string | null; end2: string | null }

export const FLAG_LABEL: Record<string, string> = {
  late: 'Late',
  late_break: 'Late from break',
  off_roster: 'No shift',
  no_gps: 'No GPS',
  manual: 'Added by manager',
  new_phone: 'New phone',
}

// Where someone is now, from their punches since yesterday (oldest first).
export function stateOf(punches: PunchLite[]): { state: State; since: string | null; shiftStart: string | null } {
  let state: State = 'off'
  let since: string | null = null
  let shiftStart: string | null = null
  for (const p of punches) {
    if (p.kind === 'in') { state = 'on'; since = p.punched_at; shiftStart = p.punched_at }
    else if (p.kind === 'break_out' && state === 'on') { state = 'break'; since = p.punched_at }
    else if (p.kind === 'break_in' && state === 'break') { state = 'on'; since = p.punched_at }
    else if (p.kind === 'out') { state = 'off'; since = p.punched_at; shiftStart = null }
  }
  return { state, since, shiftStart }
}

// What each state allows.
export const allowed: Record<State, Kind[]> = { off: ['in'], on: ['break_out', 'out'], break: ['break_in', 'out'] }

export const minutesOfDay = (iso: string) => {
  const t = new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false })
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const hhmm = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

// Minutes late against the shift start (or the second block's start, when the clock-in
// is nearer to it). 0 when on time or within the grace.
export function lateMinutes(at: string, shift: Shift): number {
  const now = minutesOfDay(at)
  const starts = [hhmm(shift.start_time), ...(shift.start2 ? [hhmm(shift.start2)] : [])]
  const start = starts.reduce((best, s) => (Math.abs(now - s) < Math.abs(now - best) ? s : best), starts[0])
  const late = now - start
  return late > LATE_GRACE_MIN ? late : 0
}

// The break the shift allows: the set break, or the gap between a split shift's blocks.
export function breakAllowance(shift: Shift | null): number {
  if (!shift) return 0
  if (shift.start2 && shift.end_time) return Math.max(0, hhmm(shift.start2) - hhmm(shift.end_time))
  return Number(shift.break_minutes) || 0
}

// Worked minutes from a day's punches: in to out, minus breaks. An open shift counts to `now`.
export function workedMinutes(punches: PunchLite[], now?: string): number {
  let total = 0
  let from: number | null = null
  for (const p of punches) {
    const t = Date.parse(p.punched_at)
    if (p.kind === 'in' || p.kind === 'break_in') from = t
    else if ((p.kind === 'break_out' || p.kind === 'out') && from !== null) { total += t - from; from = null }
  }
  if (from !== null && now) total += Date.parse(now) - from
  return Math.round(total / 60_000)
}

export const hoursText = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
export const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
export const dayOfIso = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })

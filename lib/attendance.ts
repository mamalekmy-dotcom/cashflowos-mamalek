// Turns raw punches into days and hours. Plain data in, plain data out, so the rules
// can be tested without a database.

const TIME_ZONE = 'Asia/Kuala_Lumpur'
const EARTH_RADIUS_M = 6_371_000

export type Punch = {
  user_id: number
  kind: string
  punched_at: string
  distance_m: number | null
  lat: number | null
}
export type PersonReport = {
  days: number
  minutes: number
  noShift: boolean
  missingOut: boolean
  farFromPin: boolean
  noGps: boolean
}

// The calendar day in Malaysia, so a 7am punch never lands on yesterday.
export const dayOf = (at: string) => new Date(at).toLocaleDateString('en-CA', { timeZone: TIME_ZONE })

// Metres between two points. A phone's GPS is rough, so treat this as a guide.
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)))
}

// Pairs each clock-in with the next clock-out. An in with no out counts as a missed
// clock-out, adds no hours, and is flagged for a person to check.
export function pairedMinutes(punches: Punch[]): { minutes: number; missingOut: boolean } {
  const sorted = [...punches].sort((a, b) => a.punched_at.localeCompare(b.punched_at))
  let minutes = 0
  let open: string | null = null
  let missingOut = false
  for (const punch of sorted) {
    if (punch.kind === 'in') {
      if (open) missingOut = true
      open = punch.punched_at
    } else if (open) {
      minutes += (Date.parse(punch.punched_at) - Date.parse(open)) / 60_000
      open = null
    }
  }
  return { minutes: Math.round(minutes), missingOut: missingOut || open !== null }
}

export function reportFor(punches: Punch[], rosteredDays: Set<string>, pinRadius: number): PersonReport {
  const byDay = new Map<string, Punch[]>()
  for (const punch of punches) {
    const day = dayOf(punch.punched_at)
    byDay.set(day, [...(byDay.get(day) ?? []), punch])
  }
  const report: PersonReport = { days: byDay.size, minutes: 0, noShift: false, missingOut: false, farFromPin: false, noGps: false }
  for (const [day, dayPunches] of byDay) {
    const { minutes, missingOut } = pairedMinutes(dayPunches)
    report.minutes += minutes
    report.missingOut ||= missingOut
    report.noShift ||= !rosteredDays.has(day)
    report.noGps ||= dayPunches.some(p => p.lat === null)
    report.farFromPin ||= dayPunches.some(p => p.distance_m !== null && p.distance_m > pinRadius)
  }
  return report
}

// Hours worked past the shift's end, rounded to 0.1h. Short overruns are ignored so a
// slow clock-out doesn't create an OT request for someone to deal with.
export function overtimeHours(clockOut: string, shiftEnd: string, graceMinutes = 15): number {
  const local = new Date(clockOut).toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour12: false })
  const [h, m] = local.split(':').map(Number)
  const [endH, endM] = shiftEnd.split(':').map(Number)
  const over = h * 60 + m - (endH * 60 + endM)
  return over > graceMinutes ? Math.round((over / 60) * 10) / 10 : 0
}

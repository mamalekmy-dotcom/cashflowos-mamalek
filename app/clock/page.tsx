import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { dayOf, pairedMinutes, type Punch } from '@/lib/attendance'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import ClockButton from './ClockButton'

export const dynamic = 'force-dynamic'

const DAYS_SHOWN = 14
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`
const timeOf = (at: string) => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })

export default async function Clock() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const today = todayISO()
  const since = new Date(Date.now() - DAYS_SHOWN * 86_400_000).toISOString()

  const [{ data: punchRows }, { data: shifts }] = await Promise.all([
    supabase.from('punches').select('user_id, kind, punched_at, distance_m, lat').eq('user_id', user.id).gte('punched_at', since).order('punched_at'),
    supabase.from('roster').select('work_date, shift_code, shift_types(start_time, end_time)').eq('user_id', user.id).gte('work_date', today).order('work_date').limit(7),
  ])
  const punches = (punchRows ?? []) as Punch[]
  const last = punches[punches.length - 1]

  const byDay = new Map<string, Punch[]>()
  for (const p of punches) byDay.set(dayOf(p.punched_at), [...(byDay.get(dayOf(p.punched_at)) ?? []), p])
  const days = [...byDay.entries()].reverse()

  return (
    <>
      <h1 className="ph">Clock in</h1>
      <p className="cap">{last?.kind === 'in' ? `On shift since ${timeOf(last.punched_at)}` : 'Not clocked in'}</p>
      <ClockButton next={last?.kind === 'in' ? 'out' : 'in'} />

      <p className="rowlabel" style={{ marginTop: 20 }}>My schedule</p>
      {shifts?.length ? (
        <table className="tbl" style={{ maxWidth: 640, marginBottom: 20 }}>
          <tbody>
            {shifts.map(s => {
              const times = s.shift_types as unknown as { start_time: string; end_time: string }
              return (
                <tr key={s.work_date}>
                  <td data-label="Day">{s.work_date}</td>
                  <td data-label="Shift">{s.shift_code}</td>
                  <td data-label="Hours">{times.start_time.slice(0, 5)}–{times.end_time.slice(0, 5)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <p className="cap">No shifts set yet.</p>}

      <p className="rowlabel">My attendance</p>
      {days.length ? (
        <table className="tbl" style={{ maxWidth: 640 }}>
          <tbody>
            {days.map(([day, list]) => {
              const { minutes, missingOut } = pairedMinutes(list)
              return (
                <tr key={day}>
                  <td data-label="Day">{day}</td>
                  <td data-label="Hours">{hours(minutes)}</td>
                  <td data-label="Status">{missingOut ? <span className="pill overdue">missing clock-out</span> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <p className="cap">No punches in the last {DAYS_SHOWN} days.</p>}
    </>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { FLAG_LABEL, breakAllowance, dayOfIso, hoursText, stateOf, timeText, workedMinutes, type Shift } from '@/lib/clock'
import { MC_PER_MONTH } from '@/lib/leaves'
import PunchDial from './PunchDial'
import LeaveApply from './LeaveApply'

export const dynamic = 'force-dynamic'

const KIND_WORD: Record<string, string> = { in: 'In', out: 'Out', break_out: 'Break', break_in: 'Back' }
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const ymShift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }
const t5 = (t: string | null) => (t ? String(t).slice(0, 5) : '')

// The staff screen: the punch dial, my attendance this month, my schedule with
// teammates, and my leave. Owners go to the Attendance tab instead.
export default async function Clock({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role === 'owner') redirect('/?tab=attendance')
  const today = todayISO()
  const { m } = await searchParams
  const month = /^\d{4}-\d{2}$/.test(m ?? '') && m! <= today.slice(0, 7) ? m! : today.slice(0, 7)
  const next = ymShift(month, 1)
  const week = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))

  const [{ data: recent }, { data: monthRows }, { data: mine }, { data: person }] = await Promise.all([
    supabase.from('punches').select('kind, punched_at').eq('user_id', user.id).gte('punched_at', new Date(Date.now() - 36 * 3_600_000).toISOString()).order('punched_at'),
    supabase.from('punches').select('kind, punched_at, flags').eq('user_id', user.id).gte('punched_at', `${month}-01T00:00:00+08:00`).lt('punched_at', `${next}-01T00:00:00+08:00`).order('punched_at'),
    supabase.from('roster').select('work_date, shift_code, shift_types(code, start_time, end_time, break_minutes, start2, end2)').eq('user_id', user.id).gte('work_date', week[0]).lte('work_date', week[6]).order('work_date'),
    supabase.from('hr_people').select('id').eq('user_id', user.id).maybeSingle(),
  ])
  const now = stateOf(recent ?? [])
  const shiftPunches = now.shiftStart ? (recent ?? []).filter(p => p.punched_at >= now.shiftStart!) : []
  const todayShift = (mine ?? []).find(r => r.work_date === today)?.shift_types as unknown as Shift | undefined

  // Teammates on the same shift each day.
  const { data: team } = (mine ?? []).length
    ? await supabase.from('roster').select('work_date, shift_code, app_users(name)').in('work_date', (mine ?? []).map(r => r.work_date)).neq('user_id', user.id)
    : { data: [] as any[] }

  // Attendance this month, by day.
  const byDay = new Map<string, { kind: string; punched_at: string; flags: string[] }[]>()
  for (const p of monthRows ?? []) byDay.set(dayOfIso(p.punched_at), [...(byDay.get(dayOfIso(p.punched_at)) ?? []), p as any])
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  const totalMin = days.reduce((s, [, ps]) => s + workedMinutes(ps), 0)

  // Leave balances.
  let leave: { annual: number | null; mc: number } | null = null
  const { data: types } = await supabase.from('hr_leave_types').select('code, name').eq('active', true).order('name')
  if (person) {
    const year = Number(today.slice(0, 4))
    const [{ data: ledger }, { data: mcs }] = await Promise.all([
      supabase.from('hr_leave_ledger').select('leave_type, delta').eq('person_id', person.id).eq('year', year),
      supabase.from('hr_leave_requests').select('days').eq('person_id', person.id).eq('leave_type', 'MC').eq('status', 'approved')
        .lte('start_date', `${today.slice(0, 7)}-31`).gte('end_date', `${today.slice(0, 7)}-01`),
    ])
    const al = (ledger ?? []).filter(l => l.leave_type === 'AL')
    leave = {
      annual: al.length ? al.reduce((s, l) => s + Number(l.delta), 0) : null,
      mc: Math.max(0, MC_PER_MONTH - (mcs ?? []).reduce((s, r) => s + Number(r.days), 0)),
    }
  }

  return (
    <div className="clock-page">
      <PunchDial state={now.state} since={now.since} shiftPunches={shiftPunches} breakAllowance={breakAllowance(todayShift ?? null)} />

      <section className="card">
        <div className="card-head">
          <p className="card-title">My attendance</p>
          <span className="btnrow">
            <Link className="btn ghost" href={`/clock?m=${ymShift(month, -1)}`} aria-label="Previous month">‹</Link>
            <span className="cap" style={{ alignSelf: 'center' }}>{monthLabel(month)}</span>
            {month < today.slice(0, 7) ? <Link className="btn ghost" href={`/clock?m=${next}`} aria-label="Next month">›</Link> : null}
          </span>
        </div>
        <div className="grid" style={{ margin: '12px 0' }}>
          <div className="stat"><p className="l">Total hours</p><p className="v">{hoursText(totalMin)}</p></div>
          <div className="stat"><p className="l">Working days</p><p className="v">{days.length}</p></div>
        </div>
        {days.length ? (
          <table className="tbl">
            <tbody>
              {days.map(([d, ps]) => {
                const flags = [...new Set(ps.flatMap(p => p.flags ?? []))]
                return (
                  <tr key={d}>
                    <td data-label="Day">{dayLabel(d)}</td>
                    <td data-label="Times">{ps.map(p => `${KIND_WORD[p.kind] ?? p.kind} ${timeText(p.punched_at)}`).join(' · ')}</td>
                    <td data-label="Hours">{hoursText(workedMinutes(ps))}</td>
                    <td data-label="">{flags.map(f => <span key={f} className="pill overdue" style={{ marginRight: 4 }}>{FLAG_LABEL[f] ?? f}</span>)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <p className="cap">No punches this month.</p>}
      </section>

      <section className="card">
        <p className="card-title">My schedule</p>
        {(mine ?? []).length ? (
          <table className="tbl">
            <tbody>
              {(mine ?? []).map(r => {
                const s = r.shift_types as unknown as Shift
                const mates = (team ?? []).filter((t: any) => t.work_date === r.work_date && t.shift_code === r.shift_code).map((t: any) => t.app_users?.name).filter(Boolean)
                const brk = breakAllowance(s)
                return (
                  <tr key={r.work_date}>
                    <td data-label="Day"><strong>{r.work_date === today ? 'Today' : dayLabel(r.work_date)}</strong></td>
                    <td data-label="Shift">{r.shift_code} · {t5(s.start_time)}–{t5(s.end_time)}{s.start2 ? `, ${t5(s.start2)}–${t5(s.end2)}` : ''}{brk ? ` · break ${brk} min` : ''}</td>
                    <td data-label="With">{mates.length ? mates.join(', ') : <span className="cap">just you</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <p className="cap">No shifts set for the next 7 days.</p>}
      </section>

      <section className="card">
        <p className="card-title">My leave</p>
        {leave ? (
          <>
            <div className="grid" style={{ margin: '8px 0 0' }}>
              <div className="stat"><p className="l">Annual leave left</p><p className="v">{leave.annual === null ? 'not set' : `${leave.annual} day${leave.annual === 1 ? '' : 's'}`}</p></div>
            </div>
            <LeaveApply today={today} types={(types ?? []).map(t => ({ code: t.code, name: t.name }))} />
          </>
        ) : <p className="cap">Your leave profile isn&apos;t linked yet. Ask the owner to link your login on your Staff profile.</p>}
      </section>
    </div>
  )
}

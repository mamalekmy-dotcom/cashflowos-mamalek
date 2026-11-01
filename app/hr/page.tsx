import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import HRTabs from './HRTabs'
import { requireManager, visiblePeople } from '@/lib/hr/guard'
import { days, whenText } from '@/lib/hr/data'
import { isHR } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Home for supervisors, HR and owners. Supervisors see their team; HR sees everyone
// plus headcount, probation and review dates.
export default async function HRHome() {
  const ctx = await requireManager()
  const hr = isHR(ctx.viewer)
  const ids = visiblePeople(ctx).filter(id => id !== ctx.viewer.personId || hr)
  const today = todayISO()
  const soon = addDays(today, 30)

  const [{ data: people }, { data: pending }, { data: away }] = await Promise.all([
    supabase.from('hr_people').select('id, full_name, department, employment_status, probation_end, next_review_date, is_demo').in('id', ids),
    supabase.from('hr_leave_requests').select('id, person_id, start_date, end_date, start_part, end_part, days')
      .in('person_id', ids).eq('status', 'pending').order('start_date'),
    supabase.from('hr_leave_requests').select('id, person_id, start_date, end_date, start_part, end_part, days')
      .in('person_id', ids).eq('status', 'approved').lte('start_date', addDays(today, 7)).gte('end_date', today).order('start_date'),
  ])
  const list = people ?? []
  const name = (id: number) => list.find(p => p.id === id)?.full_name ?? '—'
  const current = list.filter(p => p.employment_status !== 'left')
  const probation = current.filter(p => p.employment_status === 'probation' && p.probation_end && p.probation_end <= soon)
    .sort((a, b) => String(a.probation_end).localeCompare(String(b.probation_end)))
  const reviews = current.filter(p => p.next_review_date && p.next_review_date <= soon)
    .sort((a, b) => String(a.next_review_date).localeCompare(String(b.next_review_date)))
  const byDept = Object.entries(current.reduce<Record<string, number>>((acc, p) => {
    const d = p.department ?? 'No department'
    acc[d] = (acc[d] ?? 0) + 1
    return acc
  }, {}))

  return (
    <>
      <h1 className="ph">HR</h1>
      <p className="cap">{hr ? 'Everyone' : 'Your team'} · today {today}</p>
      <HRTabs active="/hr" hr={hr} manager trainer />

      <div className="grid">
        <Stat label="Leave to decide" value={pending?.length ?? 0} yes={!!pending?.length} href="/hr/leave" />
        <Stat label="Away in the next 7 days" value={away?.length ?? 0} />
        {hr ? <Stat label="Headcount" value={current.length} href="/hr/people" /> : null}
        {hr ? <Stat label="Probation ending ≤30 days" value={probation.length} yes={probation.length > 0} /> : null}
      </div>

      {pending?.length ? (
        <>
          <p className="rowlabel" style={{ marginTop: 18 }}>Waiting for your decision</p>
          {pending.map(r => (
            <Link className="admin-card" key={r.id} href="/hr/leave" style={{ display: 'block' }}>
              <p className="rowlabel" style={{ marginBottom: 2 }}>{name(r.person_id)} · {days(r.days)}</p>
              <p className="cap" style={{ margin: 0 }}>{whenText(r)}</p>
            </Link>
          ))}
        </>
      ) : null}

      <p className="rowlabel" style={{ marginTop: 18 }}>Away this week</p>
      {away?.length
        ? away.map(r => <p className="cap" key={r.id} style={{ margin: '2px 0' }}>• {name(r.person_id)}: {whenText(r)}</p>)
        : <p className="cap">Nobody on approved leave.</p>}

      {hr ? (
        <>
          <p className="rowlabel" style={{ marginTop: 18 }}>Headcount</p>
          <p className="cap">{byDept.map(([d, n]) => `${d}: ${n}`).join(' · ') || 'No profiles yet. Add them under People.'}</p>
          <p className="rowlabel" style={{ marginTop: 18 }}>Probation ending soon</p>
          {probation.length ? probation.map(p => <p className="cap" key={p.id} style={{ margin: '2px 0' }}>• <Link href={`/hr/people/${p.id}`}>{p.full_name}</Link>: {p.probation_end}</p>) : <p className="cap">None in the next 30 days.</p>}
          <p className="rowlabel" style={{ marginTop: 18 }}>Reviews due soon</p>
          {reviews.length ? reviews.map(p => <p className="cap" key={p.id} style={{ margin: '2px 0' }}>• <Link href={`/hr/people/${p.id}`}>{p.full_name}</Link>: {p.next_review_date}</p>) : <p className="cap">None in the next 30 days.</p>}
          {list.some(p => p.is_demo) ? <p className="cap" style={{ marginTop: 18 }}>⚠️ Demo profiles are included in these numbers. They are named “DEMO — …”.</p> : null}
        </>
      ) : null}
    </>
  )
}

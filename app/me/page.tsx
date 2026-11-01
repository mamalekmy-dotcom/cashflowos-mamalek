import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import LeaveSummary from '@/app/hr/LeaveSummary'
import { LeaveForm } from '@/app/hr/HRControls'
import { requireHRContext } from '@/lib/hr/guard'
import { leaveFor } from '@/lib/hr/data'
import { isHR, teamOf } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// The employee home: my leave, my details and what's next. Everyone gets this page,
// and it only ever reads the logged-in person's own rows.
export default async function MyHR() {
  const ctx = await requireHRContext()
  const today = todayISO()
  const year = Number(today.slice(0, 4))
  const manages = isHR(ctx.viewer) || teamOf(ctx.viewer, ctx.people).size > 0
  const managerLink = manages ? <p className="cap"><Link href="/hr">Open the team HR page →</Link></p> : null

  if (!ctx.viewer.personId) {
    return (
      <>
        <h1 className="ph">My HR</h1>
        {managerLink}
        <div className="empty"><p>Your HR profile isn’t set up yet. Ask HR to link your login to your staff profile.</p></div>
      </>
    )
  }

  const [{ data: me }, leave] = await Promise.all([
    supabase.from('hr_people').select('full_name, preferred_name, department, position, join_date, employment_status, probation_end, next_review_date')
      .eq('id', ctx.viewer.personId).single(),
    leaveFor(ctx.viewer.personId, year),
  ])
  const waiting = leave.requests.filter(r => r.status === 'pending').length
  const upcoming = leave.requests.filter(r => r.status === 'approved' && r.end_date >= today)
  const next = [
    waiting && `${waiting} leave request${waiting > 1 ? 's' : ''} waiting for a decision`,
    upcoming[0] && `Next approved leave starts ${upcoming[upcoming.length - 1].start_date}`,
    me?.probation_end && me.employment_status === 'probation' && `Probation ends ${me.probation_end}`,
    me?.next_review_date && `Next review ${me.next_review_date}`,
  ].filter(Boolean) as string[]

  return (
    <>
      <h1 className="ph">Hi {me?.preferred_name || me?.full_name}</h1>
      <p className="cap">{[me?.position, me?.department].filter(Boolean).join(' · ') || 'My HR'}</p>
      {managerLink}

      <div className="grid">
        {leave.balances.slice(0, 3).map(b => (
          <Stat key={b.leave_type} label={`${leave.types.find(t => t.code === b.leave_type)?.name ?? b.leave_type} left`} value={b.available} />
        ))}
        <Stat label="Waiting for a decision" value={waiting} yes={waiting > 0} />
      </div>

      {next.length ? (
        <div className="admin-card">
          <p className="rowlabel">Next</p>
          {next.map(n => <p className="cap" key={n} style={{ margin: '2px 0' }}>• {n}</p>)}
        </div>
      ) : null}

      <h2 className="rowlabel" style={{ marginTop: 20 }}>My leave {year}</h2>
      <LeaveForm types={leave.types.filter(t => t.active).map(t => ({ value: t.code, label: t.name }))} today={today} />
      <LeaveSummary {...leave} canCancel={r => r.status === 'pending'} />

      <p className="cap" style={{ marginTop: 20 }}>Onboarding, learning and company handbook arrive in the next HR release.</p>
    </>
  )
}

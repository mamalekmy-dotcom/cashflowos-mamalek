import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import LeaveSummary from '@/app/hr/LeaveSummary'
import { LeaveForm } from '@/app/hr/HRControls'
import { CompleteSelf } from '@/app/hr/LearningControls'
import { requireHRContext, trainees } from '@/lib/hr/guard'
import { leaveFor } from '@/lib/hr/data'
import { cultureFor, learningFor, LEARNING_LABEL } from '@/lib/hr/learning'
import { isHR, taskState, teamOf } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// The employee home: my next actions, leave, onboarding, training and company
// content to acknowledge. Everyone gets this page, and it only ever reads the
// logged-in person's own rows.
export default async function MyHR() {
  const ctx = await requireHRContext()
  const today = todayISO()
  const year = Number(today.slice(0, 4))
  const manages = isHR(ctx.viewer) || teamOf(ctx.viewer, ctx.people).size > 0
  const trains = (await trainees(ctx)).length > 0
  const links = (
    <p className="cap">
      {manages ? <><Link href="/hr">Team HR →</Link>{' · '}</> : null}
      {trains ? <><Link href="/hr/onboarding">Training I give →</Link>{' · '}</> : null}
      <Link href="/hr/culture">Company &amp; culture →</Link>
    </p>
  )

  if (!ctx.viewer.personId) {
    return (
      <>
        <h1 className="ph">My HR</h1>
        {links}
        <div className="empty"><p>Your HR profile isn’t set up yet. Ask HR to link your login to your staff profile.</p></div>
      </>
    )
  }

  const personId = ctx.viewer.personId
  const { data: me } = await supabase.from('hr_people')
    .select('id, full_name, preferred_name, department, position, join_date, employment_status, probation_end, next_review_date')
    .eq('id', personId).single()
  const [leave, learning, culture, { data: plans }] = await Promise.all([
    leaveFor(personId, year),
    me ? learningFor(me, today) : Promise.resolve([]),
    cultureFor(personId),
    supabase.from('hr_onboarding_plans').select('id, name').eq('person_id', personId).eq('status', 'active'),
  ])
  const { data: tasks } = plans?.length
    ? await supabase.from('hr_onboarding_tasks').select('id, plan_id, checkpoint, title, due_date, instructed_at, practised_at, acknowledged_at, assessed_at, outcome')
      .in('plan_id', plans.map(p => p.id)).order('due_date')
    : { data: [] }

  const waiting = leave.requests.filter(r => r.status === 'pending').length
  const upcoming = leave.requests.filter(r => r.status === 'approved' && r.end_date >= today)
  const toLearn = learning.filter(l => l.state !== 'done')
  const toAck = culture.filter(c => c.version.requires_ack && !c.acknowledgedAt)
  const openTasks = (tasks ?? []).filter(t => taskState(t, today) !== 'done')
  const ackTasks = openTasks.filter(t => (t.instructed_at || t.practised_at) && !t.acknowledged_at)

  const next = [
    ackTasks.length && `Acknowledge ${ackTasks.length} onboarding task${ackTasks.length > 1 ? 's' : ''}`,
    toAck.length && `Read and acknowledge ${toAck.length} company document${toAck.length > 1 ? 's' : ''}`,
    toLearn.filter(l => l.state === 'overdue').length && `${toLearn.filter(l => l.state === 'overdue').length} training item(s) overdue`,
    waiting && `${waiting} leave request${waiting > 1 ? 's' : ''} waiting for a decision`,
    upcoming[0] && `Next approved leave starts ${upcoming[upcoming.length - 1].start_date}`,
    me?.probation_end && me.employment_status === 'probation' && `Probation ends ${me.probation_end}`,
    me?.next_review_date && `Next review ${me.next_review_date}`,
  ].filter(Boolean) as string[]

  return (
    <>
      <h1 className="ph">Hi {me?.preferred_name || me?.full_name}</h1>
      <p className="cap">{[me?.position, me?.department].filter(Boolean).join(' · ') || 'My HR'}</p>
      {links}

      <div className="grid">
        {leave.balances.slice(0, 2).map(b => (
          <Stat key={b.leave_type} label={`${leave.types.find(t => t.code === b.leave_type)?.name ?? b.leave_type} left`} value={b.available} />
        ))}
        <Stat label="Training to do" value={toLearn.length} yes={toLearn.some(l => l.state === 'overdue')} />
        <Stat label="To acknowledge" value={toAck.length + ackTasks.length} yes={toAck.length + ackTasks.length > 0} href={toAck.length ? '/hr/culture' : undefined} />
      </div>

      {next.length ? (
        <div className="admin-card">
          <p className="rowlabel">Next</p>
          {next.map(n => <p className="cap" key={n} style={{ margin: '2px 0' }}>• {n}</p>)}
        </div>
      ) : null}

      {plans?.length ? (
        <>
          <h2 className="rowlabel" style={{ marginTop: 20 }}>My onboarding</h2>
          {plans.map(p => {
            const mine = (tasks ?? []).filter(t => t.plan_id === p.id)
            const left = mine.filter(t => taskState(t, today) !== 'done')
            return (
              <div className="admin-card" key={p.id}>
                <p className="rowlabel" style={{ marginBottom: 2 }}><Link href={`/hr/onboarding/${p.id}`}>{p.name}</Link> · {mine.length - left.length}/{mine.length} done</p>
                {left.slice(0, 3).map(t => <p className="cap" key={t.id} style={{ margin: '2px 0' }}>• {t.checkpoint}: {t.title}{t.due_date ? ` (due ${t.due_date})` : ''}</p>)}
              </div>
            )
          })}
        </>
      ) : null}

      {learning.length ? (
        <>
          <h2 className="rowlabel" style={{ marginTop: 20 }}>My training</h2>
          {learning.map(l => (
            <div className="admin-card" key={l.course.id}>
              <p className="rowlabel" style={{ marginBottom: 2 }}>{l.course.title} · {LEARNING_LABEL[l.state]}{l.due ? ` · ${l.state === 'done' ? 'refresh by' : 'due'} ${l.due}` : ''}</p>
              {l.version.source_url ? <p className="cap" style={{ margin: '0 0 6px' }}><a href={l.version.source_url} target="_blank" rel="noreferrer">Open ↗</a></p> : null}
              {l.version.body && l.state !== 'done' ? <p className="cap" style={{ whiteSpace: 'pre-wrap' }}>{l.version.body}</p> : null}
              {l.state !== 'done'
                ? l.course.kind === 'practical' ? <p className="cap" style={{ margin: 0 }}>Your trainer signs this off after a demonstration.</p> : <CompleteSelf versionId={l.version.id} />
                : null}
            </div>
          ))}
        </>
      ) : null}

      <h2 className="rowlabel" style={{ marginTop: 20 }}>My leave {year}</h2>
      <LeaveForm types={leave.types.filter(t => t.active).map(t => ({ value: t.code, label: t.name }))} today={today} />
      <LeaveSummary {...leave} canCancel={r => r.status === 'pending'} />
    </>
  )
}

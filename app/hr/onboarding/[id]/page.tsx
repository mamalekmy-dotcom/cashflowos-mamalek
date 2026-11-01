import Link from 'next/link'
import { notFound } from 'next/navigation'
import HRTabs from '../../HRTabs'
import { AckTask, AssessForm, CommentForm, PlanStatus, TaskStep, TrainersForm } from '../../LearningControls'
import { mayTrain, requireHRContext, trainees } from '@/lib/hr/guard'
import { ONBOARDING_TASK_COLS, OUTCOME_LABEL, stamp, type OnboardingTask } from '@/lib/hr/learning'
import { isHR, taskState, teamOf } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STATE: Record<string, string> = { done: '✅ Done', follow_up: '🔁 Follow-up', overdue: '⏰ Overdue', open: '○ Open' }

// One onboarding plan. The new staff member sees it to acknowledge each task;
// trainers record instruction, practice and assessment; HR and the supervisor also
// manage trainers and status. Each of the four records is its own stamp.
export default async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireHRContext()
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()
  const { data: plan } = await supabase.from('hr_onboarding_plans')
    .select('id, person_id, name, start_date, status, primary_trainer_id, backup_trainer_id').eq('id', id).maybeSingle()
  if (!plan) notFound()
  const self = plan.person_id === ctx.viewer.personId
  const trains = await mayTrain(ctx, plan.person_id)
  if (!self && !trains) notFound()
  const hr = isHR(ctx.viewer)
  const manages = hr || teamOf(ctx.viewer, ctx.people).has(plan.person_id)
  const today = todayISO()

  const [{ data: person }, { data: rows }, { data: users }] = await Promise.all([
    supabase.from('hr_people').select('full_name, preferred_name, position, department').eq('id', plan.person_id).single(),
    supabase.from('hr_onboarding_tasks').select(ONBOARDING_TASK_COLS).eq('plan_id', id).order('due_date').order('position'),
    supabase.from('app_users').select('id, name').eq('active', true).order('name'),
  ])
  const tasks = (rows ?? []) as OnboardingTask[]
  const who = (uid: number | null) => (uid ? users?.find(u => u.id === uid)?.name ?? '—' : '')
  const checkpoints = [...new Set(tasks.map(t => t.checkpoint))]
  const open = plan.status === 'active'
  const done = tasks.filter(t => taskState(t, today) === 'done').length

  return (
    <>
      <h1 className="ph">{person?.preferred_name || person?.full_name} · {plan.name}</h1>
      <p className="cap">
        {self && !trains ? <Link href="/me">← My HR</Link> : <Link href="/hr/onboarding">← Onboarding</Link>}
        {' · '}Started {plan.start_date} · {done}/{tasks.length} done · {plan.status}
        {' · '}<Link href={`/hr/onboarding/${id}/print`}>Print A4 checklist</Link>
      </p>
      {trains ? <HRTabs active="/hr/onboarding" hr={hr} manager={hr || teamOf(ctx.viewer, ctx.people).size > 0} trainer={(await trainees(ctx)).length > 0} /> : null}
      <p className="cap">Trainer: {who(plan.primary_trainer_id) || 'not named'}{plan.backup_trainer_id ? ` · Backup: ${who(plan.backup_trainer_id)}` : ''}</p>

      {checkpoints.map(cp => (
        <div key={cp}>
          <p className="rowlabel" style={{ marginTop: 16 }}>{cp}</p>
          {tasks.filter(t => t.checkpoint === cp).map(t => (
            <div className="admin-card" key={t.id}>
              <p className="rowlabel" style={{ marginBottom: 2 }}>{t.title} <span className="cap">· {STATE[taskState(t, today)]}{t.due_date ? ` · due ${t.due_date}` : ''}</span></p>
              {t.instruction ? <p className="cap" style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>{t.instruction}</p> : null}
              {t.source_url ? <p className="cap" style={{ margin: '0 0 6px' }}><a href={t.source_url} target="_blank" rel="noreferrer">Open the guide ↗</a></p> : null}

              <table className="tbl" style={{ marginBottom: 8 }}>
                <tbody>
                  <tr><td data-label="Step">1 · Instructed</td><td data-label="Record">{t.instructed_at ? `${who(t.instructed_by)} · ${stamp(t.instructed_at)}` : '—'}</td>
                    <td>{trains && open && !t.instructed_at ? <TaskStep id={t.id} step="instructed" label="Record" /> : null}</td></tr>
                  <tr><td data-label="Step">2 · Practised</td><td data-label="Record">{t.practised_at ? `${who(t.practised_by)} · ${stamp(t.practised_at)}` : '—'}</td>
                    <td>{trains && open && !t.practised_at ? <TaskStep id={t.id} step="practised" label="Record" /> : null}</td></tr>
                  <tr><td data-label="Step">3 · Employee acknowledged</td><td data-label="Record">{t.acknowledged_at ? stamp(t.acknowledged_at) : '—'}</td>
                    <td>{self && open && !t.acknowledged_at ? <AckTask id={t.id} /> : null}</td></tr>
                  <tr><td data-label="Step">4 · Trainer assessed</td><td data-label="Record">{t.assessed_at ? `${OUTCOME_LABEL[t.outcome ?? ''] ?? ''} · ${who(t.assessed_by)} · ${stamp(t.assessed_at)}` : '—'}</td>
                    <td>{trains && open ? <AssessForm taskId={t.id} /> : null}</td></tr>
                </tbody>
              </table>
              {t.follow_up ? <p className="cap" style={{ margin: '0 0 4px' }}>🔁 Follow-up: {t.follow_up}{t.follow_up_due ? ` (by ${t.follow_up_due})` : ''}</p> : null}
              {t.comment ? <p className="cap" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>💬 {t.comment}</p> : null}
              {trains && open ? <CommentForm taskId={t.id} /> : null}
            </div>
          ))}
        </div>
      ))}

      {manages ? (
        <>
          <TrainersForm planId={id} primary={String(plan.primary_trainer_id ?? '')} backup={String(plan.backup_trainer_id ?? '')}
            logins={(users ?? []).map(u => ({ value: String(u.id), label: u.name }))} />
          <div className="btnrow" style={{ flexWrap: 'wrap' }}>
            {open ? <PlanStatus id={id} status="completed" label="Mark completed" /> : <PlanStatus id={id} status="active" label="Reopen" />}
            {open ? <PlanStatus id={id} status="cancelled" label="Cancel plan" /> : null}
          </div>
        </>
      ) : null}
    </>
  )
}

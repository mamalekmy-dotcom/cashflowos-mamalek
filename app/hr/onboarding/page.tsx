import Link from 'next/link'
import HRTabs from '../HRTabs'
import { DEPARTMENTS } from '../HRControls'
import { RemoveTemplateTask, StartPlanForm, TemplateForm, TemplateTaskForm } from '../LearningControls'
import { requireTrainerView } from '@/lib/hr/guard'
import { isHR, taskState, teamOf } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Onboarding plans this person may see (HR: all; supervisors: their team; trainers:
// their trainees), plus template management for HR.
export default async function Onboarding({ searchParams }: { searchParams: Promise<{ tab?: string; t?: string; all?: string }> }) {
  const ctx = await requireTrainerView()
  const hr = isHR(ctx.viewer)
  const team = teamOf(ctx.viewer, ctx.people)
  const { tab, t, all } = await searchParams
  const today = todayISO()

  const [{ data: plans }, { data: people }, { data: templates }] = await Promise.all([
    supabase.from('hr_onboarding_plans').select('id, person_id, name, start_date, status').in('person_id', ctx.trainees)
      .in('status', all ? ['active', 'completed', 'cancelled'] : ['active']).order('start_date', { ascending: false }),
    supabase.from('hr_people').select('id, full_name, preferred_name').in('id', ctx.trainees).neq('employment_status', 'left').order('full_name'),
    supabase.from('hr_onboarding_templates').select('id, name, department, position').eq('active', true).order('name'),
  ])
  const { data: tasks } = plans?.length
    ? await supabase.from('hr_onboarding_tasks').select('plan_id, instructed_at, practised_at, acknowledged_at, assessed_at, outcome, due_date').in('plan_id', plans.map(p => p.id))
    : { data: [] }
  const name = (id: number) => { const p = people?.find(x => x.id === id); return p?.preferred_name || p?.full_name || '—' }
  const canStart = (people ?? []).filter(p => hr || team.has(p.id))

  if (tab === 'templates' && hr) {
    const chosen = templates?.find(x => String(x.id) === t)
    const { data: tt } = chosen
      ? await supabase.from('hr_onboarding_template_tasks').select('id, checkpoint, day_offset, title, instruction, source_url').eq('template_id', chosen.id).order('day_offset').order('position')
      : { data: [] }
    return (
      <>
        <h1 className="ph">Onboarding templates</h1>
        <p className="cap"><Link href="/hr/onboarding">← Plans</Link></p>
        <HRTabs active="/hr/onboarding" hr manager trainer />
        <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {(templates ?? []).map(x => <Link key={x.id} className={`btn${chosen?.id === x.id ? '' : ' ghost'}`} href={`/hr/onboarding?tab=templates&t=${x.id}`}>{x.name}</Link>)}
        </div>
        {chosen ? (
          <>
            <p className="rowlabel">{chosen.name}{chosen.department ? ` · ${chosen.department}` : ''}{chosen.position ? ` · ${chosen.position}` : ''}</p>
            {tt?.length ? (
              <table className="tbl">
                <thead><tr><th>Checkpoint</th><th>Due</th><th>Task</th><th>Instruction</th><th></th></tr></thead>
                <tbody>
                  {tt.map(x => (
                    <tr key={x.id}>
                      <td data-label="Checkpoint">{x.checkpoint}</td>
                      <td data-label="Due">+{x.day_offset}d</td>
                      <td data-label="Task">{x.title}{x.source_url ? <> · <a href={x.source_url} target="_blank" rel="noreferrer">file ↗</a></> : null}</td>
                      <td data-label="Instruction">{x.instruction ?? ''}</td>
                      <td><RemoveTemplateTask id={x.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="cap">No tasks yet.</p>}
            <TemplateTaskForm templateId={chosen.id} />
          </>
        ) : <p className="cap">Pick a template above, or create one.</p>}
        <TemplateForm departments={DEPARTMENTS} />
      </>
    )
  }

  return (
    <>
      <h1 className="ph">Onboarding</h1>
      <p className="cap">
        {hr ? 'Everyone' : team.size ? 'Your team and trainees' : 'Your trainees'} · {all ? <Link href="/hr/onboarding">Active only</Link> : <Link href="/hr/onboarding?all=1">Show finished</Link>}
        {hr ? <> · <Link href="/hr/onboarding?tab=templates">Templates</Link></> : null}
      </p>
      <HRTabs active="/hr/onboarding" hr={hr} manager={hr || team.size > 0} trainer />

      {plans?.length ? (
        <table className="tbl">
          <thead><tr><th>Person</th><th>Plan</th><th>Started</th><th>Done</th><th>Needs attention</th></tr></thead>
          <tbody>
            {plans.map(p => {
              const mine = (tasks ?? []).filter(x => x.plan_id === p.id)
              const states = mine.map(x => taskState(x, today))
              return (
                <tr key={p.id}>
                  <td data-label="Person"><Link href={`/hr/onboarding/${p.id}`}>{name(p.person_id)}</Link></td>
                  <td data-label="Plan">{p.name}{p.status !== 'active' ? ` (${p.status})` : ''}</td>
                  <td data-label="Started">{p.start_date}</td>
                  <td data-label="Done">{states.filter(s => s === 'done').length}/{mine.length}</td>
                  <td data-label="Needs attention">{[states.filter(s => s === 'overdue').length && `${states.filter(s => s === 'overdue').length} overdue`, states.filter(s => s === 'follow_up').length && `${states.filter(s => s === 'follow_up').length} follow-up`].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <div className="empty"><p>No onboarding in progress.</p></div>}

      {canStart.length ? (
        <StartPlanForm
          people={canStart.map(p => ({ value: String(p.id), label: p.preferred_name || p.full_name }))}
          templates={(templates ?? []).map(x => ({ value: String(x.id), label: x.name }))}
          today={today}
        />
      ) : null}
    </>
  )
}

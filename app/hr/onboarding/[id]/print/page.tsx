import { notFound } from 'next/navigation'
import { mayTrain, requireHRContext } from '@/lib/hr/guard'
import { ONBOARDING_TASK_COLS, OUTCOME_LABEL, stamp, type OnboardingTask } from '@/lib/hr/learning'
import { supabase } from '@/lib/supabase'
import PrintButton from './PrintButton'

export const dynamic = 'force-dynamic'

// A4 checklist for the floor. What's already recorded prints filled in; the rest
// prints as blank boxes to tick and sign by hand. Same access rule as the plan page.
export default async function PrintPlan({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireHRContext()
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()
  const { data: plan } = await supabase.from('hr_onboarding_plans').select('id, person_id, name, start_date, primary_trainer_id, backup_trainer_id').eq('id', id).maybeSingle()
  if (!plan || (plan.person_id !== ctx.viewer.personId && !(await mayTrain(ctx, plan.person_id)))) notFound()

  const [{ data: person }, { data: rows }, { data: users }] = await Promise.all([
    supabase.from('hr_people').select('full_name, position, department').eq('id', plan.person_id).single(),
    supabase.from('hr_onboarding_tasks').select(ONBOARDING_TASK_COLS).eq('plan_id', id).order('due_date').order('position'),
    supabase.from('app_users').select('id, name'),
  ])
  const tasks = (rows ?? []) as OnboardingTask[]
  const who = (uid: number | null) => (uid ? users?.find(u => u.id === uid)?.name ?? '' : '')
  const box = (at: string | null, by?: number | null) => (at ? `✔ ${who(by ?? null)} ${stamp(at)}`.trim() : '☐')
  const checkpoints = [...new Set(tasks.map(t => t.checkpoint))]

  return (
    <div className="a4">
      <style>{`
        @page { size: A4; margin: 12mm; }
        .a4 { max-width: 186mm; margin: 0 auto; font-size: 10.5pt; color: #000; background: #fff; }
        .a4 h1 { font-size: 15pt; margin: 0 0 2mm; }
        .a4 table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; page-break-inside: auto; }
        .a4 th, .a4 td { border: 0.3mm solid #444; padding: 1.5mm; vertical-align: top; text-align: left; }
        .a4 th { background: #eee; font-size: 9pt; }
        .a4 tr { page-break-inside: avoid; }
        .a4 .meta { margin: 0 0 4mm; font-size: 9.5pt; }
        .a4 .sign { margin-top: 8mm; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        .a4 .sign div { border-top: 0.3mm solid #000; padding-top: 1mm; font-size: 9pt; }
        @media print { .side, .bottomnav, .noprint { display: none !important; } .main { padding: 0 !important; margin: 0 !important; } }
      `}</style>
      <PrintButton />
      <h1>Onboarding checklist · {plan.name}</h1>
      <p className="meta">
        <strong>{person?.full_name}</strong>{person?.position ? ` · ${person.position}` : ''}{person?.department ? ` · ${person.department}` : ''}<br />
        Start date: {plan.start_date} · Trainer: {who(plan.primary_trainer_id) || '________________'} · Backup: {who(plan.backup_trainer_id) || '________________'}
      </p>
      {checkpoints.map(cp => (
        <table key={cp}>
          <thead>
            <tr><th colSpan={6}>{cp}</th></tr>
            <tr><th style={{ width: '30%' }}>Task</th><th>Due</th><th>Instructed</th><th>Practised</th><th>Employee ack.</th><th>Trainer assessment</th></tr>
          </thead>
          <tbody>
            {tasks.filter(t => t.checkpoint === cp).map(t => (
              <tr key={t.id}>
                <td><strong>{t.title}</strong>{t.instruction ? <><br /><span style={{ fontSize: '9pt' }}>{t.instruction}</span></> : null}
                  {t.comment ? <><br /><em style={{ fontSize: '8.5pt' }}>{t.comment}</em></> : null}</td>
                <td>{t.due_date ?? ''}</td>
                <td>{box(t.instructed_at, t.instructed_by)}</td>
                <td>{box(t.practised_at, t.practised_by)}</td>
                <td>{box(t.acknowledged_at)}</td>
                <td>{t.assessed_at ? `${OUTCOME_LABEL[t.outcome ?? ''] ?? ''} · ${who(t.assessed_by)} ${stamp(t.assessed_at)}` : '☐ Competent  ☐ Follow-up  ☐ Not yet'}
                  {t.follow_up ? <><br /><span style={{ fontSize: '8.5pt' }}>Follow-up: {t.follow_up}{t.follow_up_due ? ` by ${t.follow_up_due}` : ''}</span></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <div className="sign">
        <div>Employee signature &amp; date</div>
        <div>Trainer / supervisor signature &amp; date</div>
      </div>
    </div>
  )
}

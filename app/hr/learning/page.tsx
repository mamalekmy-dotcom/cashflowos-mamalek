import HRTabs from '../HRTabs'
import { DEPARTMENTS } from '../HRControls'
import { AssignForm, CourseForm, CourseVersionForm, SignOffForm } from '../LearningControls'
import { requireTrainerView } from '@/lib/hr/guard'
import { coursesWithLatest, learningFor, LEARNING_LABEL } from '@/lib/hr/learning'
import { isHR, teamOf } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = { sop: 'SOP', pdf: 'PDF', video: 'Video', text: 'Text', practical: 'Practical' }
const TARGET = (kind: string, target: string | null, name: (id: number) => string) =>
  kind === 'everyone' ? 'Everyone' : kind === 'person' ? name(Number(target)) : `${kind === 'department' ? 'Dept' : 'Position'}: ${target}`

// Training. HR manages courses and assignments. Supervisors and trainers see where
// their trainees stand and sign off practical training. Only names are read here;
// no profile, leave or restricted fields.
export default async function Learning() {
  const ctx = await requireTrainerView()
  const hr = isHR(ctx.viewer)
  const team = teamOf(ctx.viewer, ctx.people)
  const today = todayISO()

  const [{ courses, latest, assignments }, { data: people }] = await Promise.all([
    coursesWithLatest(),
    supabase.from('hr_people').select('id, full_name, preferred_name, department, position, join_date')
      .in('id', ctx.trainees).neq('employment_status', 'left').order('full_name'),
  ])
  const name = (id: number) => { const p = people?.find(x => x.id === id); return p?.preferred_name || p?.full_name || `#${id}` }
  const rows = await Promise.all((people ?? []).map(async p => ({ p, learning: await learningFor(p, today) })))
  const open = rows.flatMap(r => r.learning.filter(l => l.state !== 'done').map(l => ({ p: r.p, l })))

  return (
    <>
      <h1 className="ph">Training</h1>
      <p className="cap">{open.length} item{open.length === 1 ? '' : 's'} not done across {rows.length} {hr ? 'staff' : 'trainees'}.</p>
      <HRTabs active="/hr/learning" hr={hr} manager={hr || team.size > 0} trainer />

      <h2 className="rowlabel">Where people stand</h2>
      {open.length ? (
        <table className="tbl">
          <thead><tr><th>Person</th><th>Course</th><th>Status</th><th>Due</th><th>Sign-off</th></tr></thead>
          <tbody>
            {open.map(({ p, l }) => (
              <tr key={`${p.id}-${l.course.id}`}>
                <td data-label="Person">{name(p.id)}</td>
                <td data-label="Course">{l.course.title} <span className="cap">({KIND[l.course.kind]} v{l.version.version})</span></td>
                <td data-label="Status">{LEARNING_LABEL[l.state]}</td>
                <td data-label="Due">{l.due}</td>
                <td data-label="Sign-off">{l.course.kind === 'practical' ? <SignOffForm personId={p.id} versionId={l.version.id} /> : <span className="cap">Staff mark it done</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">Everyone is up to date{courses.length ? '' : ' (no courses yet)'}.</p>}

      <h2 className="rowlabel" style={{ marginTop: 20 }}>Courses</h2>
      {courses.map(c => {
        const v = latest.get(c.id)
        const as = assignments.filter(a => a.course_id === c.id)
        return (
          <details className="admin-card" key={c.id}>
            <summary className="rowlabel">{c.title} · {KIND[c.kind]}{v ? ` · v${v.version}` : ' · no version yet'}</summary>
            {c.description ? <p className="cap">{c.description}</p> : null}
            {v?.source_url ? <p className="cap"><a href={v.source_url} target="_blank" rel="noreferrer">Open v{v.version} ↗</a>{v.change_note ? ` · ${v.change_note}` : ''}</p> : null}
            {v?.body ? <p className="cap" style={{ whiteSpace: 'pre-wrap' }}>{v.body}</p> : null}
            <p className="cap">Assigned to: {as.map(a => `${TARGET(a.target_kind, a.target, name)} (due ${a.due_days}d${a.refresher_months ? `, refresh every ${a.refresher_months}m` : ''})`).join(' · ') || 'nobody yet'}</p>
            {hr ? <CourseVersionForm courseId={c.id} /> : null}
            {v && (hr || team.size) ? (
              <AssignForm courseId={c.id} departments={DEPARTMENTS} hr={hr}
                people={(people ?? []).filter(p => hr || team.has(p.id)).map(p => ({ value: String(p.id), label: name(p.id) }))} />
            ) : null}
          </details>
        )
      })}
      {!courses.length ? <p className="cap">No courses yet.</p> : null}
      {hr ? <CourseForm /> : null}
    </>
  )
}

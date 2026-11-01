import Link from 'next/link'
import { notFound } from 'next/navigation'
import HRTabs from '../../HRTabs'
import LeaveSummary from '../../LeaveSummary'
import { LeaveForm, LedgerForm, PersonEditor, PrivateEditor } from '../../HRControls'
import { mayDecideLeave, maySeePerson, requireManager } from '@/lib/hr/guard'
import { leaveFor } from '@/lib/hr/data'
import { canSeeRestricted, isHR } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const BASIC = 'id, full_name, preferred_name, department, position, career_level, manager_id, join_date, employment_status, probation_end, next_review_date, is_demo'
const CONTACT = 'user_id, phone, emergency_contacts'

// One person. Supervisors get the basics and leave; HR also gets contact details,
// restricted fields and the edit forms. A person outside your view is a 404, so the
// page doesn't even confirm they exist.
export default async function Person({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireManager()
  const id = Number((await params).id)
  if (!Number.isInteger(id) || !maySeePerson(ctx, id)) notFound()
  const hr = isHR(ctx.viewer)
  const restricted = canSeeRestricted(ctx.viewer)
  const today = todayISO()
  const year = Number(today.slice(0, 4))

  const { data: p } = await supabase.from('hr_people').select(hr ? `${BASIC}, ${CONTACT}` : BASIC).eq('id', id).maybeSingle()
  if (!p) notFound()
  const person = p as unknown as Record<string, string | number | boolean | null | { note?: string }[]>
  const [leave, priv, everyone, users] = await Promise.all([
    leaveFor(id, year),
    restricted ? supabase.from('hr_people_private').select('id_number, bank_details, salary, medical_notes').eq('person_id', id).maybeSingle() : null,
    hr ? supabase.from('hr_people').select('id, full_name').neq('id', id).order('full_name') : null,
    hr ? supabase.from('app_users').select('id, name, email').eq('active', true).order('name') : null,
  ])
  const manager = ctx.people.find(x => x.id === person.manager_id)
  const managerName = manager ? (await supabase.from('hr_people').select('full_name').eq('id', manager.id).single()).data?.full_name : ''
  const str = (v: unknown) => (v == null ? '' : String(v))
  const types = leave.types.filter(t => t.active).map(t => ({ value: t.code, label: t.name }))

  return (
    <>
      <h1 className="ph">{str(person.preferred_name) || str(person.full_name)}{person.is_demo ? ' (demo)' : ''}</h1>
      <p className="cap"><Link href="/hr/people">← People</Link></p>
      <HRTabs active="/hr/people" hr={hr} />

      {hr ? (
        <PersonEditor
          initial={{
            id, full_name: str(person.full_name), preferred_name: str(person.preferred_name), department: str(person.department),
            position: str(person.position), career_level: str(person.career_level), manager_id: str(person.manager_id),
            user_id: str(person.user_id), join_date: str(person.join_date), employment_status: str(person.employment_status),
            probation_end: str(person.probation_end), next_review_date: str(person.next_review_date), phone: str(person.phone),
            emergency_contacts: ((person.emergency_contacts as { note?: string }[] | null) ?? []).map(c => c.note).filter(Boolean).join('; '),
          }}
          managers={(everyone?.data ?? []).map(m => ({ value: String(m.id), label: m.full_name }))}
          logins={(users?.data ?? []).map(u => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
        />
      ) : (
        <div className="admin-card">
          <p className="cap" style={{ margin: 0 }}>{[person.position, person.department, person.career_level].filter(Boolean).join(' · ')}</p>
          <p className="cap" style={{ margin: '4px 0 0' }}>Status: {str(person.employment_status)}{person.join_date ? ` · joined ${person.join_date}` : ''}{managerName ? ` · reports to ${managerName}` : ''}</p>
        </div>
      )}

      {restricted ? (
        <PrivateEditor personId={id} initial={{
          id_number: str(priv?.data?.id_number), bank_details: str(priv?.data?.bank_details),
          salary: str(priv?.data?.salary), medical_notes: str(priv?.data?.medical_notes),
        }} />
      ) : null}

      <h2 className="rowlabel" style={{ marginTop: 20 }}>Leave {year}</h2>
      <LeaveSummary {...leave} canCancel={r => r.status === 'approved' && mayDecideLeave(ctx, id)} />
      {hr ? <LeaveForm types={types} personId={id} today={today} /> : null}
      {hr ? <LedgerForm personId={id} types={types} year={year} /> : null}
    </>
  )
}

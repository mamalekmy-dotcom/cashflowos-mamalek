import Link from 'next/link'
import HRTabs from '../HRTabs'
import { PersonEditor } from '../HRControls'
import { requireManager, visiblePeople } from '@/lib/hr/guard'
import { isHR } from '@/lib/hr/rules'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, string> = { probation: 'Probation', confirmed: 'Confirmed', notice: 'Notice', left: 'Left' }

// The directory. HR sees everyone and can add people; supervisors see their team.
// Only basic columns are read here. Restricted fields never leave hr_people_private.
export default async function People({ searchParams }: { searchParams: Promise<{ add?: string; left?: string }> }) {
  const ctx = await requireManager()
  const hr = isHR(ctx.viewer)
  const { add, left } = await searchParams
  const [{ data }, { data: users }] = await Promise.all([
    supabase.from('hr_people').select('id, full_name, preferred_name, department, position, employment_status, join_date, manager_id, is_demo')
      .in('id', visiblePeople(ctx)).order('full_name'),
    hr ? supabase.from('app_users').select('id, name, email').eq('active', true).order('name') : Promise.resolve({ data: [] }),
  ])
  const all = data ?? []
  const people = left ? all : all.filter(p => p.employment_status !== 'left')
  const name = (id: number | null) => all.find(p => p.id === id)?.full_name ?? ''

  return (
    <>
      <h1 className="ph">People</h1>
      <p className="cap">{people.length} {left ? 'including leavers' : 'current'} · <Link href={left ? '/hr/people' : '/hr/people?left=1'}>{left ? 'Hide leavers' : 'Show leavers'}</Link></p>
      <HRTabs active="/hr/people" hr={hr} manager trainer />

      {hr ? (add
        ? <PersonEditor
            initial={{ full_name: '', preferred_name: '', department: '', position: '', career_level: '', manager_id: '', user_id: '', join_date: '', employment_status: 'probation', probation_end: '', next_review_date: '', phone: '', emergency_contacts: '' }}
            managers={all.map(p => ({ value: String(p.id), label: p.full_name }))}
            logins={(users ?? []).map(u => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
          />
        : <p><Link className="btn" href="/hr/people?add=1">Add a staff profile</Link></p>) : null}

      {people.length ? (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Dept</th><th>Position</th><th>Status</th><th>Reports to</th></tr></thead>
          <tbody>
            {people.map(p => (
              <tr key={p.id}>
                <td data-label="Name"><Link href={`/hr/people/${p.id}`}>{p.preferred_name || p.full_name}</Link>{p.is_demo ? ' (demo)' : ''}</td>
                <td data-label="Dept">{p.department ?? ''}</td>
                <td data-label="Position">{p.position ?? ''}</td>
                <td data-label="Status">{STATUS[p.employment_status] ?? p.employment_status}</td>
                <td data-label="Reports to">{name(p.manager_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="empty"><p>No staff profiles yet.{hr ? ' Add the first one above.' : ''}</p></div>}
    </>
  )
}

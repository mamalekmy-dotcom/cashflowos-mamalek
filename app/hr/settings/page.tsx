import HRTabs from '../HRTabs'
import { CountRulesForm, GrantForm, HolidayForm, LeaveTypeForm, RemoveGrant, RemoveHoliday } from '../HRControls'
import { countRules, requireHRAdmin } from '@/lib/hr/guard'
import { leaveTypes } from '@/lib/hr/data'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const CAP: Record<string, string> = { hr_admin: 'HR admin', supervisor: 'Supervisor', trainer: 'Trainer' }

// HR's rule book. Everything here starts empty: the app never guesses a policy.
export default async function HRSettings() {
  const ctx = await requireHRAdmin()
  const [types, rules, { data: holidays }, { data: grants }, { data: users }] = await Promise.all([
    leaveTypes(),
    countRules(),
    supabase.from('hr_holidays').select('day, name').order('day'),
    supabase.from('hr_grants').select('id, user_id, capability, department').order('capability'),
    supabase.from('app_users').select('id, name').eq('active', true).order('name'),
  ])
  const who = (id: number) => users?.find(u => u.id === id)?.name ?? `#${id}`

  return (
    <>
      <h1 className="ph">HR settings</h1>
      <p className="cap">Fill these in from approved company policy only. Changes apply to new requests.</p>
      <HRTabs active="/hr/settings" hr />

      <h2 className="rowlabel">Leave types</h2>
      {types.length ? (
        <table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th>Half days</th><th>Below zero</th><th>Open</th><th>Policy note</th></tr></thead>
          <tbody>
            {types.map(t => (
              <tr key={t.code}>
                <td data-label="Code">{t.code}</td><td data-label="Name">{t.name}</td>
                <td data-label="Half days">{t.allow_half_day ? 'Yes' : 'No'}</td><td data-label="Below zero">{t.allow_negative ? 'Yes' : 'No'}</td>
                <td data-label="Open">{t.active ? 'Yes' : 'No'}</td><td data-label="Policy note">{t.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">⚠️ No leave types yet. Staff can’t apply until at least one is added. Entitlements per person are set on each profile.</p>}
      <LeaveTypeForm />

      <h2 className="rowlabel" style={{ marginTop: 20 }}>Counting rules</h2>
      <CountRulesForm initial={rules} />

      <h2 className="rowlabel" style={{ marginTop: 20 }}>Public holidays</h2>
      {holidays?.length ? (
        <table className="tbl">
          <tbody>
            {holidays.map(h => (
              <tr key={h.day}><td data-label="Date">{h.day}</td><td data-label="Name">{h.name}</td><td><RemoveHoliday day={h.day} /></td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">None yet.</p>}
      <HolidayForm />

      <h2 className="rowlabel" style={{ marginTop: 20 }}>HR roles</h2>
      <p className="cap">Separate from app roles. Supervisors approve their team’s leave; trainers only ever see training records.</p>
      {grants?.length ? (
        <table className="tbl">
          <tbody>
            {grants.map(g => (
              <tr key={g.id}>
                <td data-label="Person">{who(g.user_id)}</td>
                <td data-label="Role">{CAP[g.capability] ?? g.capability}</td>
                <td data-label="Department">{g.department === '*' ? 'All' : g.department}</td>
                <td><RemoveGrant id={g.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">Nobody yet. Owners already have full HR access.</p>}
      <GrantForm logins={(users ?? []).map(u => ({ value: String(u.id), label: u.name }))} canAddHR={ctx.viewer.appRole === 'owner'} />
    </>
  )
}

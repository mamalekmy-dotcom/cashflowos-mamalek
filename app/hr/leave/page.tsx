import HRTabs from '../HRTabs'
import { CancelButton, DecideButtons } from '../HRControls'
import { mayDecideLeave, requireManager, visiblePeople } from '@/lib/hr/guard'
import { days, leaveTypes, REQUEST_COLS, typeName, whenText, type LeaveRequest } from '@/lib/hr/data'
import { datesBetween, isHR } from '@/lib/hr/rules'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Leave to decide, and who else is off on those dates so the decision is informed.
export default async function TeamLeave() {
  const ctx = await requireManager()
  const ids = visiblePeople(ctx)
  const today = todayISO()

  const [types, { data: people }, { data: live }] = await Promise.all([
    leaveTypes(),
    supabase.from('hr_people').select('id, full_name, user_id, department').in('id', ids),
    supabase.from('hr_leave_requests').select(REQUEST_COLS).in('person_id', ids)
      .in('status', ['pending', 'approved']).gte('end_date', today).order('start_date'),
  ])
  const requests = (live ?? []) as LeaveRequest[]
  const name = (id: number) => people?.find(p => p.id === id)?.full_name ?? '—'
  const toDecide = requests.filter(r => r.status === 'pending' && mayDecideLeave(ctx, r.person_id))
  const approved = requests.filter(r => r.status === 'approved')

  // Roster for the dates being asked about, so a supervisor sees the shifts at risk.
  const span = toDecide.length ? [toDecide[0].start_date, toDecide.reduce((m, r) => (r.end_date > m ? r.end_date : m), today)] : null
  const { data: roster } = span
    ? await supabase.from('roster').select('user_id, work_date, shift_code').gte('work_date', span[0]).lte('work_date', span[1])
    : { data: [] }

  const othersOff = (r: LeaveRequest) => {
    const dates = new Set(datesBetween(r.start_date, r.end_date))
    return requests.filter(o => o.id !== r.id && o.person_id !== r.person_id && datesBetween(o.start_date, o.end_date).some(d => dates.has(d)))
  }
  const shiftsFor = (r: LeaveRequest) => {
    const userId = people?.find(p => p.id === r.person_id)?.user_id
    return (roster ?? []).filter(s => s.user_id === userId && s.work_date >= r.start_date && s.work_date <= r.end_date)
  }

  return (
    <>
      <h1 className="ph">Leave</h1>
      <p className="cap">Requests from {isHR(ctx.viewer) ? 'everyone' : 'your team'}. Nobody can decide their own.</p>
      <HRTabs active="/hr/leave" hr={isHR(ctx.viewer)} manager trainer />

      <p className="rowlabel">To decide · {toDecide.length}</p>
      {toDecide.length ? toDecide.map(r => {
        const clash = othersOff(r)
        const shifts = shiftsFor(r)
        return (
          <div className="admin-card" key={r.id}>
            <p className="rowlabel" style={{ marginBottom: 2 }}>{name(r.person_id)} · {typeName(types, r.leave_type)} · {days(r.days)}</p>
            <p className="cap" style={{ margin: 0 }}>{whenText(r)}{r.reason ? ` · ${r.reason}` : ''}</p>
            <p className="cap" style={{ margin: '4px 0' }}>
              {shifts.length ? `Rostered on: ${shifts.map(s => `${s.work_date.slice(5)} ${s.shift_code}`).join(', ')}` : 'No shifts rostered on these dates yet.'}
            </p>
            <p className="cap" style={{ margin: '0 0 10px' }}>
              {clash.length ? `Also off: ${clash.map(o => `${name(o.person_id)} (${o.status === 'pending' ? 'waiting' : 'approved'})`).join(', ')}` : 'Nobody else off on these dates.'}
            </p>
            <DecideButtons id={r.id} version={r.version} />
          </div>
        )
      }) : <p className="cap">Nothing waiting.</p>}

      <p className="rowlabel" style={{ marginTop: 18 }}>Approved, coming up</p>
      {approved.length ? approved.map(r => (
        <div className="admin-card" key={r.id}>
          <p className="rowlabel" style={{ marginBottom: 2 }}>{name(r.person_id)} · {typeName(types, r.leave_type)} · {days(r.days)}</p>
          <p className="cap" style={{ margin: '0 0 10px' }}>{whenText(r)}</p>
          {mayDecideLeave(ctx, r.person_id) ? <CancelButton id={r.id} version={r.version} label="Cancel and give days back" /> : null}
        </div>
      )) : <p className="cap">No upcoming approved leave.</p>}
    </>
  )
}

'use client'
import { useState, useTransition } from 'react'
import {
  addGrant, addLedgerLine, applyLeave, cancelLeave, createStaff, decideLeave, removeGrant, removeHoliday,
  saveCountRules, saveHoliday, saveLeaveType, savePerson, savePrivate, type PersonForm,
} from './actions'
import { POSITIONS, type Capability, type Part } from '@/lib/hr/rules'

type Opt = { value: string; label: string }
const gap = { marginTop: 10 }
const Msg = ({ text }: { text: string }) => (text ? <p className="cap" style={{ margin: '10px 0 0' }}>{text}</p> : null)

function useAction() {
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const go = (fn: () => Promise<{ message: string }>) => run(async () => setMessage((await fn()).message))
  return { message, pending, go }
}

function Select({ label, value, onChange, options, blank }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; blank?: string }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <select className="login-input" value={value} onChange={e => onChange(e.target.value)}>
        {blank !== undefined ? <option value="">{blank}</option> : null}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <input className="login-input" type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

const PART_OPTS: Opt[] = [{ value: 'full', label: 'Full day' }, { value: 'am', label: 'Morning only' }, { value: 'pm', label: 'Afternoon only' }]

// ---------------------------------------------------------------- leave
export function LeaveForm({ types, personId, today }: { types: Opt[]; personId?: number; today: string }) {
  const [type, setType] = useState(types[0]?.value ?? '')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [startPart, setStartPart] = useState<Part>('full')
  const [endPart, setEndPart] = useState<Part>('full')
  const [reason, setReason] = useState('')
  const { message, pending, go } = useAction()
  if (!types.length) return <p className="cap">No leave types are set up yet. HR adds them in HR settings.</p>
  const oneDay = start === end
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => applyLeave({ personId, type, start, end, startPart, endPart: oneDay ? startPart : endPart, reason })) }}>
      <p className="rowlabel">{personId ? 'Record leave' : 'Apply for leave'}</p>
      <Select label="Type" value={type} onChange={setType} options={types} />
      <Field label="From" type="date" value={start} onChange={v => { setStart(v); if (end < v) setEnd(v) }} />
      <Select label={oneDay ? 'Which part of the day' : 'First day'} value={startPart} onChange={v => setStartPart(v as Part)} options={oneDay ? PART_OPTS : PART_OPTS.filter(p => p.value !== 'am')} />
      <Field label="To" type="date" value={end} onChange={setEnd} />
      {!oneDay ? <Select label="Last day" value={endPart} onChange={v => setEndPart(v as Part)} options={PART_OPTS.filter(p => p.value !== 'pm')} /> : null}
      <Field label="Reason (optional)" value={reason} onChange={setReason} />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending || !type} style={{ marginTop: 12 }}>{personId ? 'Record' : 'Send for approval'}</button>
    </form>
  )
}

export function DecideButtons({ id, version }: { id: number; version: number }) {
  const [note, setNote] = useState('')
  const { message, pending, go } = useAction()
  return (
    <>
      <input className="login-input" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 10 }} />
      <div className="btnrow">
        <button className="btn" type="button" disabled={pending} onClick={() => go(() => decideLeave(id, version, true, note))}>Approve</button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => go(() => decideLeave(id, version, false, note))}>Reject</button>
      </div>
      <Msg text={message} />
    </>
  )
}

export function CancelButton({ id, version, label = 'Cancel request' }: { id: number; version: number; label?: string }) {
  const [sure, setSure] = useState(false)
  const { message, pending, go } = useAction()
  return (
    <>
      {sure
        ? <div className="btnrow">
            <button className="btn" type="button" disabled={pending} onClick={() => go(() => cancelLeave(id, version, ''))}>Yes, cancel it</button>
            <button className="btn ghost" type="button" onClick={() => setSure(false)}>Keep it</button>
          </div>
        : <button className="btn ghost" type="button" onClick={() => setSure(true)}>{label}</button>}
      <Msg text={message} />
    </>
  )
}

export function LedgerForm({ personId, types, year }: { personId: number; types: Opt[]; year: number }) {
  const [type, setType] = useState(types[0]?.value ?? '')
  const [kind, setKind] = useState('entitlement')
  const [days, setDays] = useState('')
  const [yr, setYr] = useState(String(year))
  const [note, setNote] = useState('')
  const { message, pending, go } = useAction()
  if (!types.length) return null
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => addLedgerLine(personId, type, Number(yr), Number(days), kind, note)) }}>
      <p className="rowlabel">Add entitlement or adjustment</p>
      <Select label="Type" value={type} onChange={setType} options={types} />
      <Select label="Kind" value={kind} onChange={setKind} options={[
        { value: 'entitlement', label: 'Entitlement for the year' },
        { value: 'accrual', label: 'Accrual' },
        { value: 'adjustment', label: 'Adjustment (+ or −)' },
      ]} />
      <Field label="Days" type="number" value={days} onChange={setDays} />
      <Field label="Year" type="number" value={yr} onChange={setYr} />
      <Field label="Source (required)" value={note} onChange={setNote} placeholder="e.g. offer letter, management decision" />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending || !days} style={{ marginTop: 12 }}>Add</button>
    </form>
  )
}

// ---------------------------------------------------------------- people
export const DEPARTMENTS = ['FOH', 'BOH', 'Management']
const POSITION_OPTS: Opt[] = POSITIONS.map(p => ({ value: p.label, label: `${p.label} (${p.department})` }))

export function AddStaff({ today }: { today: string }) {
  const blank = { fullName: '', position: '', phone: '', email: '', joinDate: today }
  const [f, setF] = useState(blank)
  const [made, setMade] = useState<{ name: string; staffNo: string; tempPassword: string } | null>(null)
  const set = (k: keyof typeof blank) => (v: string) => setF(s => ({ ...s, [k]: v }))
  const { message, pending, go } = useAction()
  return (
    <>
      {made ? (
        <div className="admin-card" role="status">
          <p className="rowlabel" style={{ margin: 0 }}>{made.name} is set up</p>
          <p className="cap" style={{ margin: '8px 0 4px' }}>
            Send these to them privately. The password shows only once, and they&apos;ll choose their own at first login.
          </p>
          <p className="cap" style={{ margin: 0 }}>Staff ID: <code>{made.staffNo}</code></p>
          <p className="cap" style={{ margin: '4px 0 0' }}>Temporary password: <code>{made.tempPassword}</code></p>
        </div>
      ) : null}
      <form className="admin-card" onSubmit={e => {
        e.preventDefault()
        go(async () => {
          const r = await createStaff(f)
          if (r.ok && r.staffNo && r.tempPassword) {
            setMade({ name: f.fullName, staffNo: r.staffNo, tempPassword: r.tempPassword })
            setF(blank)
          }
          return r
        })
      }}>
        <p className="rowlabel">Create a staff ID</p>
        <Field label="Full name" value={f.fullName} onChange={set('fullName')} />
        <Select label="Position" value={f.position} onChange={set('position')} options={POSITION_OPTS} blank="Pick one" />
        <Field label="Phone (optional)" value={f.phone} onChange={set('phone')} />
        <Field label="Email (optional)" type="email" value={f.email} onChange={set('email')} />
        <Field label="Joined" type="date" value={f.joinDate} onChange={set('joinDate')} />
        <Msg text={message} />
        <button className="btn" type="submit" disabled={pending || !f.fullName || !f.position} style={{ marginTop: 12 }}>
          {pending ? 'Creating…' : 'Create staff ID'}
        </button>
      </form>
    </>
  )
}

export function PersonEditor({ initial, managers, logins }: { initial: PersonForm; managers: Opt[]; logins: Opt[] }) {
  const [f, setF] = useState(initial)
  const set = (k: keyof PersonForm) => (v: string) => setF(s => ({ ...s, [k]: v }))
  const pickPosition = (position: string) =>
    setF(s => ({ ...s, position, department: POSITIONS.find(p => p.label === position)?.department ?? s.department }))
  const positions = POSITIONS.some(p => p.label === f.position) || !f.position
    ? POSITION_OPTS
    : [{ value: f.position, label: f.position }, ...POSITION_OPTS]
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => {
      e.preventDefault()
      go(async () => {
        const r = await savePerson(f)
        if (r.ok && !f.id && r.id) window.location.href = `/hr/people/${r.id}`
        return r
      })
    }}>
      <p className="rowlabel">{f.id ? 'Profile' : 'New staff profile'}</p>
      <Field label="Full name" value={f.full_name} onChange={set('full_name')} />
      <Field label="Preferred name" value={f.preferred_name} onChange={set('preferred_name')} />
      <Select label="Position" value={f.position} onChange={pickPosition} options={positions} blank="—" />
      <Select label="Department" value={f.department} onChange={set('department')} options={DEPARTMENTS.map(d => ({ value: d, label: d }))} blank="—" />
      <Field label="Career level" value={f.career_level} onChange={set('career_level')} />
      <Select label="Reports to" value={f.manager_id} onChange={set('manager_id')} options={managers} blank="Nobody" />
      <Select label="Login" value={f.user_id} onChange={set('user_id')} options={logins} blank="No login yet" />
      <Field label="Joined" type="date" value={f.join_date} onChange={set('join_date')} />
      <Select label="Status" value={f.employment_status} onChange={set('employment_status')} options={[
        { value: 'probation', label: 'Probation' }, { value: 'confirmed', label: 'Confirmed' },
        { value: 'notice', label: 'Serving notice' }, { value: 'left', label: 'Left' },
      ]} />
      <Field label="Probation ends" type="date" value={f.probation_end} onChange={set('probation_end')} />
      <Field label="Next review" type="date" value={f.next_review_date} onChange={set('next_review_date')} />
      <Field label="Phone" value={f.phone} onChange={set('phone')} />
      <Field label="Emergency contact" value={f.emergency_contacts} onChange={set('emergency_contacts')} placeholder="Name, relation, phone" />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Save</button>
    </form>
  )
}

export function PrivateEditor({ personId, initial }: { personId: number; initial: { id_number: string; bank_details: string; salary: string; medical_notes: string } }) {
  const [f, setF] = useState(initial)
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => savePrivate(personId, f)) }}>
      <p className="rowlabel">🔒 Restricted (HR only)</p>
      <Field label="IC / passport" value={f.id_number} onChange={set('id_number')} />
      <Field label="Bank details" value={f.bank_details} onChange={set('bank_details')} />
      <Field label="Salary (RM)" type="number" value={f.salary} onChange={set('salary')} />
      <Field label="Medical notes" value={f.medical_notes} onChange={set('medical_notes')} />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Save restricted details</button>
    </form>
  )
}

// ---------------------------------------------------------------- settings
export function LeaveTypeForm() {
  const [f, setF] = useState({ code: '', name: '', allow_half_day: false, allow_negative: false, active: true, notes: '' })
  const { message, pending, go } = useAction()
  const check = (k: 'allow_half_day' | 'allow_negative' | 'active', label: string) => (
    <label className="cap" style={{ display: 'flex', gap: 8, alignItems: 'center', ...gap }}>
      <input type="checkbox" checked={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.checked }))} /> {label}
    </label>
  )
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => saveLeaveType(f)) }}>
      <p className="rowlabel">Add or change a leave type</p>
      <Field label="Code" value={f.code} onChange={v => setF(s => ({ ...s, code: v }))} placeholder="e.g. annual" />
      <Field label="Name" value={f.name} onChange={v => setF(s => ({ ...s, name: v }))} placeholder="e.g. Annual leave" />
      {check('allow_half_day', 'Half days allowed')}
      {check('allow_negative', 'Can go below zero (e.g. unpaid leave)')}
      {check('active', 'Staff can apply for it')}
      <Field label="Policy note" value={f.notes} onChange={v => setF(s => ({ ...s, notes: v }))} placeholder="Where the rule comes from" />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Save leave type</button>
    </form>
  )
}

export function HolidayForm() {
  const [day, setDay] = useState('')
  const [name, setName] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => saveHoliday(day, name)) }}>
      <p className="rowlabel">Add a public holiday</p>
      <Field label="Date" type="date" value={day} onChange={setDay} />
      <Field label="Name" value={name} onChange={setName} />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Save holiday</button>
    </form>
  )
}

export function RemoveHoliday({ day }: { day: string }) {
  const { pending, go } = useAction()
  return <button className="btn ghost" type="button" disabled={pending} onClick={() => go(() => removeHoliday(day))}>Remove</button>
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function CountRulesForm({ initial }: { initial: { skipWeekdays: number[]; skipHolidays: boolean } }) {
  const [days, setDays] = useState(initial.skipWeekdays)
  const [hols, setHols] = useState(initial.skipHolidays)
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => saveCountRules(days, hols)) }}>
      <p className="rowlabel">How leave days are counted</p>
      <p className="cap">Ticked days don’t use leave. Leave everything unticked to count every calendar day.</p>
      <div className="btnrow" style={{ flexWrap: 'wrap' }}>
        {WEEKDAYS.map((w, i) => (
          <label key={w} className="cap" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={days.includes(i)} onChange={e => setDays(d => e.target.checked ? [...d, i] : d.filter(x => x !== i))} /> {w}
          </label>
        ))}
      </div>
      <label className="cap" style={{ display: 'flex', gap: 8, alignItems: 'center', ...gap }}>
        <input type="checkbox" checked={hols} onChange={e => setHols(e.target.checked)} /> Public holidays don’t use leave
      </label>
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Save rules</button>
    </form>
  )
}

export function GrantForm({ logins, canAddHR }: { logins: Opt[]; canAddHR: boolean }) {
  const [user, setUser] = useState(logins[0]?.value ?? '')
  const [cap, setCap] = useState<Capability>('supervisor')
  const [dept, setDept] = useState('')
  const { message, pending, go } = useAction()
  const caps: Opt[] = [
    { value: 'supervisor', label: 'Supervisor (approves team leave)' },
    { value: 'trainer', label: 'Trainer (training records only)' },
    ...(canAddHR ? [{ value: 'hr_admin', label: 'HR admin (all records, restricted fields)' }] : []),
  ]
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => addGrant(Number(user), cap, dept)) }}>
      <p className="rowlabel">Give someone an HR role</p>
      <Select label="Person" value={user} onChange={setUser} options={logins} />
      <Select label="Role" value={cap} onChange={v => setCap(v as Capability)} options={caps} />
      <Select label="Department" value={dept} onChange={setDept} options={DEPARTMENTS.map(d => ({ value: d, label: d }))} blank="All departments" />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending || !user} style={{ marginTop: 12 }}>Add</button>
    </form>
  )
}

export function RemoveGrant({ id }: { id: number }) {
  const { message, pending, go } = useAction()
  return <>{message ? <span className="cap">{message} </span> : null}<button className="btn ghost" type="button" disabled={pending} onClick={() => go(() => removeGrant(id))}>Remove</button></>
}

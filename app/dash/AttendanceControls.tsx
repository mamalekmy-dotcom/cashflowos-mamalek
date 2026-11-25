'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addPunch, decideDevice, markAbsent } from './attendance-actions'

function useAct() {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const go = (f: () => Promise<{ ok: boolean; message: string }>) => run(async () => {
    const r = await f()
    setMessage(r.message)
    if (r.ok) router.refresh()
  })
  return { message, pending, go }
}

export function DeviceButtons({ id }: { id: number }) {
  const { message, pending, go } = useAct()
  return (
    <span className="btnrow" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <button type="button" className="btn" disabled={pending} style={{ padding: '5px 12px' }} onClick={() => go(() => decideDevice(id, true))}>Approve phone</button>
      <button type="button" className="btn ghost" disabled={pending} style={{ padding: '5px 12px' }} onClick={() => go(() => decideDevice(id, false))}>Reject</button>
      {message ? <span className="cap">{message}</span> : null}
    </span>
  )
}

export function AbsentButton({ userId, day, absent }: { userId: number; day: string; absent: boolean }) {
  const { message, pending, go } = useAct()
  return (
    <>
      <button type="button" className="btn ghost" disabled={pending} style={{ padding: '4px 10px', fontSize: 13 }}
        onClick={() => go(() => markAbsent(userId, day, absent))}>{absent ? 'Undo absent' : 'Mark absent'}</button>
      {message ? <span className="cap"> {message}</span> : null}
    </>
  )
}

export function AddPunchForm({ staff, day }: { staff: { id: number; name: string }[]; day: string }) {
  const { message, pending, go } = useAct()
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState(String(staff[0]?.id ?? ''))
  const [kind, setKind] = useState('in')
  const [date, setDate] = useState(day)
  const [time, setTime] = useState('10:00')
  if (!open) return <button type="button" className="btn ghost" onClick={() => setOpen(true)}>+ Add a missed punch</button>
  return (
    <form className="att-add" onSubmit={e => { e.preventDefault(); go(() => addPunch(Number(who), date, time, kind)) }}>
      <select className="login-input" value={who} onChange={e => setWho(e.target.value)} aria-label="Staff">
        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="login-input" value={kind} onChange={e => setKind(e.target.value)} aria-label="Punch">
        <option value="in">Clock in</option><option value="break_out">Start break</option>
        <option value="break_in">Back from break</option><option value="out">Clock out</option>
      </select>
      <input className="login-input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Day" />
      <input className="login-input" type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Time" />
      <button type="submit" className="btn" disabled={pending || !who}>Add</button>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
      {message ? <span className="cap">{message}</span> : null}
    </form>
  )
}

'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { applyLeave } from '@/app/hr/actions'

// "Apply leave" on the staff clock-in screen. Goes to the owners' Leaves tab.
export default function LeaveApply({ today, types }: { today: string; types: { code: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState(types[0]?.code ?? 'AL')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)} style={{ marginTop: 12 }}>Apply leave</button>
  return (
    <form style={{ marginTop: 12 }} onSubmit={e => {
      e.preventDefault()
      run(async () => {
        const r = await applyLeave({ type, start, end, startPart: 'full', endPart: 'full', reason })
        setMessage(r.message)
        if (r.ok) { setOpen(false); router.refresh() }
      })
    }}>
      <label className="cap">Leave type
        <select className="login-input" value={type} onChange={e => setType(e.target.value)}>
          {types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
      </label>
      <div className="btnrow" style={{ marginTop: 8 }}>
        <label className="cap" style={{ flex: 1 }}>From<input className="login-input" type="date" value={start} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} /></label>
        <label className="cap" style={{ flex: 1 }}>To<input className="login-input" type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      <label className="cap" style={{ display: 'block', marginTop: 8 }}>Reason (optional)<input className="login-input" value={reason} onChange={e => setReason(e.target.value)} /></label>
      {message ? <p className="cap">{message}</p> : null}
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn" disabled={pending}>{pending ? 'Sending…' : 'Send request'}</button>
      </div>
    </form>
  )
}

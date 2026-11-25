'use client'
import { useState, useTransition } from 'react'
import { decideLeave } from '@/app/hr/actions'

// Approve / Reject one leave request from the homepage Leaves tab. Uses the same
// server action as HR → Leave approvals, so the same permission and ledger rules apply.
export default function LeaveDecide({ id, version }: { id: number; version: number }) {
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const [pending, run] = useTransition()
  const go = (approve: boolean) => run(async () => {
    const r = await decideLeave(id, version, approve, '')
    setMessage(r.message)
    if (r.ok) setDone(true)
  })
  if (done) return <span className="cap">{message}</span>
  return (
    <span className="btnrow" style={{ justifyContent: 'flex-end' }}>
      <button type="button" className="btn" disabled={pending} onClick={() => go(true)} style={{ padding: '5px 12px' }}>Approve</button>
      <button type="button" className="btn ghost" disabled={pending} onClick={() => go(false)} style={{ padding: '5px 12px' }}>Reject</button>
      {message ? <span className="cap">{message}</span> : null}
    </span>
  )
}

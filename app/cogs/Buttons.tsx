'use client'
import { useState, useTransition } from 'react'
import { markClosed, refreshFromSheet } from './actions'

export function RefreshButton() {
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <button className="btn ghost" type="button" disabled={pending} onClick={() => run(async () => setMessage((await refreshFromSheet()).message))}>
        {pending ? 'Reading Stock 2026…' : 'Refresh from Stock 2026 now'}
      </button>
      {message ? <span className="cap" style={{ margin: 0 }}>{message}</span> : null}
    </div>
  )
}

export function ClosedButton({ month, closed }: { month: string; closed: boolean }) {
  const [pending, run] = useTransition()
  return (
    <button className="btn ghost" type="button" disabled={pending} style={{ padding: '5px 10px', fontSize: 13 }}
      onClick={() => run(async () => { await markClosed(month, !closed) })}>
      {closed ? 'Undo' : 'Closing count done'}
    </button>
  )
}

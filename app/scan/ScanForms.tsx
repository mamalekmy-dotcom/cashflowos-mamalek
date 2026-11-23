'use client'
import { useRef, useState, useTransition } from 'react'
import { submitClaim } from './actions'

export function ClaimForm({ today }: { today: string }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await submitClaim(Number(amount), note, date)
      setMessage(result.message)
      if (result.ok) {
        setAmount('')
        setNote('')
      }
    })
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">New claim</p>
      <input className="login-input" inputMode="decimal" placeholder="Amount (RM)" value={amount} onChange={e => setAmount(e.target.value)} />
      <input className="login-input" placeholder="What was it for?" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" type="date" aria-label="Date" value={date} onChange={e => setDate(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !amount || !note} style={{ marginTop: 12 }}>Send claim</button>
    </form>
  )
}

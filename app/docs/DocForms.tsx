'use client'
import { useState, useTransition } from 'react'
import { acceptDocument, enterPin, rejectDocument } from './actions'

export function PinForm({ firstTime }: { firstTime: boolean }) {
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await enterPin(pin)
      setPin('')
      if (result.ok) window.location.reload()
      else setMessage(result.message)
    })
  }

  return (
    <form className="admin-card" onSubmit={submit} style={{ maxWidth: 320 }}>
      <p className="rowlabel">{firstTime ? 'Choose a 4-digit PIN' : 'Enter your 4-digit PIN'}</p>
      <input className="login-input" type="password" inputMode="numeric" maxLength={4} aria-label="PIN" value={pin} onChange={e => setPin(e.target.value)} autoFocus />
      {message ? <p className="login-error">{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || pin.length !== 4} style={{ marginTop: 12 }}>
        {firstTime ? 'Set PIN' : 'Unlock'}
      </button>
    </form>
  )
}

export type DocRow = {
  id: number
  kind: string
  merchant: string | null
  note: string | null
  amount: number | null
  doc_date: string | null
  url: string | null
  by: string
}

export function ReviewDoc({ doc, today }: { doc: DocRow; today: string }) {
  const [merchant, setMerchant] = useState(doc.merchant ?? doc.note ?? '')
  const [amount, setAmount] = useState(doc.amount != null ? String(doc.amount) : '')
  const [date, setDate] = useState(doc.doc_date ?? today)
  const [category, setCategory] = useState(doc.kind === 'claim' ? 'other' : 'food')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  return (
    <div className="admin-card">
      <p className="rowlabel" style={{ marginBottom: 2 }}>{doc.kind} from {doc.by}</p>
      {doc.url ? <p className="cap" style={{ margin: '0 0 10px' }}><a href={doc.url} target="_blank" rel="noreferrer">Open the file</a></p> : null}
      <input className="login-input" placeholder="Supplier or description" aria-label="Supplier or description" value={merchant} onChange={e => setMerchant(e.target.value)} />
      <input className="login-input" inputMode="decimal" placeholder="Amount (RM)" aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" type="date" aria-label="Date" value={date} onChange={e => setDate(e.target.value)} style={{ marginTop: 10 }} />
      <select className="login-input" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} style={{ marginTop: 10 }}>
        <option value="food">Food</option>
        <option value="labor">Labour</option>
        <option value="rent">Rent</option>
        <option value="other">Other</option>
      </select>
      {message ? <p className="login-error">{message}</p> : null}
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn" type="button" disabled={pending || !amount} onClick={() => start(async () => setMessage((await acceptDocument(doc.id, { amount: Number(amount), date, category, merchant })).message))}>Accept</button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => start(async () => setMessage((await rejectDocument(doc.id)).message))}>Reject</button>
      </div>
    </div>
  )
}

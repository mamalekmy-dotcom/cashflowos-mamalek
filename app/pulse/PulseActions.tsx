'use client'
import { useState, useTransition } from 'react'
import { addCost, logDay, uploadColmo } from './actions'

type Result = { ok: boolean; message: string }

export function DayCell({ date, day, sales }: { date: string; day: number; sales: number | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(sales === null ? '' : String(sales))
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const result = await logDay(date, Number(value))
      if (result.ok) setEditing(false)
    })
  }

  if (editing) {
    return (
      <div className="pulse-day editing">
        <span className="pulse-num">{day}</span>
        <input
          className="login-input pulse-input"
          inputMode="decimal"
          aria-label={`Sales for ${date}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          autoFocus
        />
        <button className="btn" type="button" disabled={pending || !value} onClick={save}>Save</button>
      </div>
    )
  }
  return (
    <button type="button" className={`pulse-day${sales ? ' has-sales' : ''}`} onClick={() => setEditing(true)}>
      <span className="pulse-num">{day}</span>
      <span className="pulse-amount">{sales ? Math.round(sales).toLocaleString('en-MY') : '+'}</span>
    </button>
  )
}

export function UploadSales() {
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="admin-card">
      <p className="rowlabel">Upload Colmo sales</p>
      <p className="cap" style={{ margin: '0 0 10px' }}>
        X Reading Report Excel files. Pick several to load past months. Uploading a month again replaces it.
      </p>
      <input
        type="file"
        accept=".xlsx"
        multiple
        aria-label="Colmo Excel files"
        onChange={e => {
          const form = new FormData()
          for (const file of Array.from(e.target.files ?? [])) form.append('files', file)
          start(async () => setResult(await uploadColmo(form)))
          e.target.value = ''
        }}
      />
      {pending ? <p className="cap" style={{ margin: '10px 0 0' }}>Reading…</p> : null}
      {result ? <p className={result.ok ? 'cap' : 'login-error'} style={{ margin: '10px 0 0' }}>{result.message}</p> : null}
    </div>
  )
}

export function AddCost({ defaultDate }: { defaultDate: string }) {
  const [date, setDate] = useState(defaultDate)
  const [category, setCategory] = useState('food')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const saved = await addCost({ date, category, amount: Number(amount), note })
      setResult(saved)
      if (saved.ok) {
        setAmount('')
        setNote('')
      }
    })
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">Add a cost</p>
      <input className="login-input" type="date" aria-label="Date" value={date} onChange={e => setDate(e.target.value)} />
      <select className="login-input" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} style={{ marginTop: 10 }}>
        <option value="food">Food</option>
        <option value="labor">Labour</option>
        <option value="rent">Rent</option>
        <option value="other">Other</option>
      </select>
      <input className="login-input" inputMode="decimal" placeholder="Amount (RM)" value={amount} onChange={e => setAmount(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 10 }} />
      {result ? <p className={result.ok ? 'cap' : 'login-error'} style={{ margin: '10px 0 0' }}>{result.message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !amount} style={{ marginTop: 12 }}>Add cost</button>
    </form>
  )
}

'use client'
import { useState, useTransition } from 'react'
import { addCategory, saveMonthExpenses } from './actions'

type Row = { id: number; name: string; amount: number }

export default function KeyInForm({ month, label, rows }: { month: string; label: string; rows: Row[] }) {
  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(rows.map(r => [r.id, r.amount ? String(r.amount) : ''])),
  )
  const [newName, setNewName] = useState('')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  return (
    <form className="admin-card" style={{ maxWidth: 640, marginTop: 16 }} onSubmit={e => {
      e.preventDefault()
      run(async () => setMessage((await saveMonthExpenses(month, rows.map(r => ({ id: r.id, amount: Number(values[r.id] || 0) })))).message))
    }}>
      <p className="rowlabel">Key in fixed costs for {label}</p>
      <p className="cap">For costs with no bill (WiFi, Bukku, bank charges). A bill sent to the bot adds on top, so don&apos;t key in a cost that also has a bill. Salaries and rental are keyed in on the FLR Report.</p>
      <div className="mgmt-keyin">
        {rows.map(r => (
          <label key={r.id} className="cap">
            {r.name} (RM)
            <input className="login-input" inputMode="decimal" placeholder="0.00" value={values[r.id] ?? ''}
              onChange={e => setValues(v => ({ ...v, [r.id]: e.target.value }))} />
          </label>
        ))}
      </div>
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>{pending ? 'Saving…' : 'Save'}</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <input className="login-input" style={{ flex: '1 1 200px' }} placeholder="New category, e.g. Signage" value={newName} onChange={e => setNewName(e.target.value)} />
        <button className="btn ghost" type="button" disabled={pending || !newName.trim()} onClick={() => run(async () => {
          const res = await addCategory(newName)
          setMessage(res.message)
          if (res.ok) setNewName('')
        })}>Add category</button>
      </div>
    </form>
  )
}

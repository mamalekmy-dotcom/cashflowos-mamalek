'use client'
import { useState, useTransition } from 'react'
import { saveMonthCosts } from './actions'

const gap = { marginTop: 10 }

export default function CostsForm({ month, label, labour, rent }: { month: string; label: string; labour: number | null; rent: number | null }) {
  const [values, setValues] = useState({ labour: labour ? String(labour) : '', rent: rent ? String(rent) : '' })
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  return (
    <form className="admin-card" onSubmit={e => {
      e.preventDefault()
      run(async () => setMessage((await saveMonthCosts(month, Number(values.labour || 0), Number(values.rent || 0))).message))
    }}>
      <p className="rowlabel">Key in costs for {label}</p>
      <label className="cap" style={{ display: 'block', ...gap }}>
        Labour cost for the month (RM)
        <input className="login-input" inputMode="decimal" placeholder="0.00" value={values.labour} onChange={e => setValues(v => ({ ...v, labour: e.target.value }))} />
      </label>
      <label className="cap" style={{ display: 'block', ...gap }}>
        Rental cost for the month (RM)
        <input className="login-input" inputMode="decimal" placeholder="0.00" value={values.rent} onChange={e => setValues(v => ({ ...v, rent: e.target.value }))} />
      </label>
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>{pending ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

'use client'
import { useState, useTransition } from 'react'
import { deleteSubscription, saveSubscription, type SubInput } from './actions'

const blank: SubInput = { name: '', amount: 0, currency: 'MYR', cycle: 'monthly', next_renewal: '', where_invoice: '', notes: '', active: true }

// Add a subscription, or edit one (pass `sub`). Owners only.
export default function SubForm({ sub }: { sub?: SubInput & { id: number } }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<SubInput>(sub ?? blank)
  const [amount, setAmount] = useState(sub ? String(sub.amount) : '')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const set = (k: keyof SubInput) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }))

  if (!open) {
    return (
      <button className={sub ? 'btn ghost' : 'btn'} type="button" onClick={() => setOpen(true)} style={sub ? { padding: '4px 10px', fontSize: 13 } : { marginBottom: 14 }}>
        {sub ? 'Edit' : '+ Add subscription'}
      </button>
    )
  }

  return (
    <form className="admin-card" style={{ maxWidth: 640, textAlign: 'left' }} onSubmit={e => {
      e.preventDefault()
      run(async () => {
        const res = await saveSubscription({ ...v, amount: Number(amount || 0) })
        setMessage(res.message)
        if (res.ok) { setOpen(false); if (!sub) { setV(blank); setAmount('') } }
      })
    }}>
      <div className="mgmt-keyin">
        <label className="cap">Name<input className="login-input" value={v.name} onChange={set('name')} placeholder="e.g. Bukku Accounting" required /></label>
        <label className="cap">Amount<input className="login-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label className="cap">Currency
          <select className="login-input" value={v.currency} onChange={set('currency')}>
            <option>MYR</option><option>USD</option><option>SGD</option>
          </select>
        </label>
        <label className="cap">Renews
          <select className="login-input" value={v.cycle} onChange={set('cycle')}>
            <option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="once">One-off / expiry</option>
          </select>
        </label>
        <label className="cap">Next renewal date<input className="login-input" type="date" value={v.next_renewal} onChange={set('next_renewal')} required /></label>
        <label className="cap">Where to get the invoice<input className="login-input" value={v.where_invoice} onChange={set('where_invoice')} placeholder="e.g. vercel.com → Settings → Billing" /></label>
      </div>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Note<input className="login-input" value={v.notes} onChange={set('notes')} placeholder="Card used, who to call, etc." /></label>
      <label className="admin-tab" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={v.active} onChange={() => setV(x => ({ ...x, active: !x.active }))} /> Send reminders (untick when cancelled)
      </label>
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <div className="btnrow" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => setOpen(false)}>Close</button>
        {sub ? (
          <button className="btn danger" type="button" disabled={pending} onClick={() => {
            if (!confirm(`Remove ${sub.name}?`)) return
            run(async () => setMessage((await deleteSubscription(sub.id)).message))
          }}>Remove</button>
        ) : null}
      </div>
    </form>
  )
}

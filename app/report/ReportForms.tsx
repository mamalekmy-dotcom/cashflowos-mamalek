'use client'
import { useState, useTransition } from 'react'
import { addPurchase, removePurchase, saveSales } from './actions'

const gap = { marginTop: 10 }

function Amount({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <input className="login-input" inputMode="decimal" placeholder="0.00" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

export function SalesForm({ day, saved }: { day: string; saved: { cash: number; qr: number; card: number } | null }) {
  const start = (n?: number) => (n ? String(n) : '')
  const [cash, setCash] = useState(start(saved?.cash))
  const [qr, setQr] = useState(start(saved?.qr))
  const [card, setCard] = useState(start(saved?.card))
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  return (
    <form className="admin-card" onSubmit={e => {
      e.preventDefault()
      run(async () => setMessage((await saveSales(day, { cash: Number(cash), qr: Number(qr), card: Number(card) })).message))
    }}>
      <p className="rowlabel">Sales collected</p>
      <Amount label="Cash sales (RM)" value={cash} onChange={setCash} />
      <Amount label="QR sales (RM)" value={qr} onChange={setQr} />
      <Amount label="Card sales (RM)" value={card} onChange={setCard} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>{pending ? 'Saving…' : 'Save sales'}</button>
    </form>
  )
}

export function PurchaseForm({ day, suppliers }: { day: string; suppliers: string[] }) {
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoInput, setPhotoInput] = useState(0)
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  return (
    <form className="admin-card" onSubmit={e => {
      e.preventDefault()
      if (!photo) return
      run(async () => {
        const form = new FormData()
        form.append('day', day)
        form.append('supplier', supplier)
        form.append('amount', amount)
        form.append('note', note)
        form.append('photo', photo)
        const result = await addPurchase(form)
        setMessage(result.message)
        if (result.ok) {
          setSupplier('')
          setAmount('')
          setNote('')
          setPhoto(null)
          setPhotoInput(n => n + 1)
        }
      })
    }}>
      <p className="rowlabel">Add a purchase</p>
      <label className="cap" style={{ display: 'block', ...gap }}>
        Supplier
        <input className="login-input" list="report-suppliers" value={supplier} onChange={e => setSupplier(e.target.value)} />
        <datalist id="report-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist>
      </label>
      <Amount label="Amount (RM)" value={amount} onChange={setAmount} />
      <label className="cap" style={{ display: 'block', ...gap }}>
        Note (optional)
        <input className="login-input" value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <label className="cap" style={{ display: 'block', ...gap }}>
        Invoice photo (required)
        <input key={photoInput} className="login-input" type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !supplier || !amount || !photo} style={{ marginTop: 12 }}>{pending ? 'Adding…' : 'Add purchase'}</button>
    </form>
  )
}

export function RemovePurchase({ id }: { id: number }) {
  const [pending, run] = useTransition()
  return <button className="btn ghost" type="button" disabled={pending} onClick={() => run(async () => { await removePurchase(id) })}>Remove</button>
}

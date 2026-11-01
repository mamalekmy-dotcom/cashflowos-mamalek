'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addItem, removeItem } from './actions'

const gap = { marginTop: 10 }
const label = { display: 'block', flex: '1 1 180px', maxWidth: 240 }

// Picking a date reloads the page straight away, with no button to press.
export function StockFilter({ month, day }: { month: string; day: string }) {
  const router = useRouter()
  return (
    <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
      <label className="cap" style={label}>
        Month
        <input className="login-input" type="month" value={month} onChange={e => { if (e.target.value) router.push(`/stock?month=${e.target.value}`) }} />
      </label>
      <label className="cap" style={label}>
        Day
        <input className="login-input" type="date" value={day} onChange={e => { if (e.target.value) router.push(`/stock?day=${e.target.value}`) }} />
      </label>
    </div>
  )
}

function Field({ label, value, onChange, list, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; list?: string; inputMode?: 'decimal'
}) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <input className="login-input" list={list} inputMode={inputMode} value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

export function AddItem({ places }: { places: { area: string; section: string }[] }) {
  const [area, setArea] = useState(places[0]?.area ?? '')
  const [section, setSection] = useState('')
  const [name, setName] = useState('')
  const [uom, setUom] = useState('')
  const [price, setPrice] = useState('')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const areas = [...new Set(places.map(p => p.area))]
  const sections = places.filter(p => p.area === area.trim().toUpperCase()).map(p => p.section)

  return (
    <details className="admin-card">
      <summary className="rowlabel" style={{ cursor: 'pointer', margin: 0 }}>Add an item</summary>
      <form onSubmit={e => {
        e.preventDefault()
        run(async () => {
          const result = await addItem({ area, section, name, uom, price: Number(price) })
          setMessage(result.message)
          if (result.ok) {
            setName('')
            setUom('')
            setPrice('')
          }
        })
      }}>
        <Field label="Area" value={area} onChange={setArea} list="stock-areas" />
        <datalist id="stock-areas">{areas.map(a => <option key={a} value={a} />)}</datalist>
        <Field label="Category" value={section} onChange={setSection} list="stock-sections" />
        <datalist id="stock-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
        <Field label="Item name" value={name} onChange={setName} />
        <Field label="Unit (optional)" value={uom} onChange={setUom} />
        <Field label="Unit price, RM (optional)" value={price} onChange={setPrice} inputMode="decimal" />
        {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
        <button className="btn" type="submit" disabled={pending || !area || !section || !name} style={{ marginTop: 12 }}>
          {pending ? 'Adding…' : 'Add item'}
        </button>
      </form>
    </details>
  )
}

export function RemoveItem({ id }: { id: number }) {
  const [pending, run] = useTransition()
  return <button className="btn ghost" type="button" disabled={pending} onClick={() => run(async () => { await removeItem(id) })}>Remove</button>
}

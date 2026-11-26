'use client'
import { useMemo, useState, useTransition } from 'react'
import { saveContact } from './actions'

type Product = {
  item: string; section: string; unit: string; price: number | null; prev: number | null; date: string | null
  supplier: string | null; times: number; fromSheet: boolean
}
type Supplier = { name: string; phone: string | null; bills: number; amount: number; products: Product[] }

const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wa = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('0') ? `6${d}` : d }
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// The next 6 delivery days: Today, Tomorrow, then weekday names.
function deliveryDays(today: string) {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000)
    const iso = d.toISOString().slice(0, 10)
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
    return { iso, label, long: i === 0 ? 'today' : i === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) }
  })
}

function Contact({ s }: { s: Supplier }) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(s.phone ?? '')
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  if (!open) return <button type="button" className="sb-add" onClick={() => setOpen(true)}>{s.phone ? 'Edit' : 'Add'}</button>
  return (
    <span className="sb-edit">
      <input className="login-input" inputMode="tel" placeholder="012-345 6789" value={phone} onChange={e => setPhone(e.target.value)} autoFocus />
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => { const r = await saveContact(s.name, phone); setMsg(r.message); if (r.ok) setOpen(false) })}>Save</button>
      {msg ? <span className="cap">{msg}</span> : null}
    </span>
  )
}

function OrderSheet({ s, all, today, onClose }: { s: Supplier; all: Product[]; today: string; onClose: () => void }) {
  // Their items first; any other food item can be added from the search box.
  const [qty, setQty] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState<Product[]>([])
  const [find, setFind] = useState('')
  const days = useMemo(() => deliveryDays(today), [today])
  const [day, setDay] = useState(days[1].iso)
  const [copied, setCopied] = useState(false)
  const list = [...s.products, ...extra]
  const picked = list.filter(p => Number(qty[p.item]) > 0)
  const total = picked.reduce((t, p) => t + (p.price ?? 0) * Number(qty[p.item]), 0)
  const when = days.find(d => d.iso === day)?.long ?? day
  const text = `Hi ${s.name}, Mama Lek order for ${when}:\n${picked.map(p => `- ${p.item}: ${qty[p.item]}${p.unit ? ` ${p.unit}` : ''}`).join('\n')}\nThank you!`
  const matches = find.trim().length >= 2
    ? all.filter(p => !list.includes(p) && p.item.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6) : []

  return (
    <div className="punch-sheet" role="dialog" aria-label={`Order from ${s.name}`} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="punch-sheet-body">
        <div className="card-head"><p className="card-title">Order · {s.name}</p><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
        <p className="cap" style={{ marginTop: 0 }}>Tick items, set quantity. The message is written for you; you press send in WhatsApp.</p>
        {list.length ? list.map(p => (
          <div className="sb-line" key={p.item}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="doc-title">{p.item}</p>
              <p className="cap" style={{ margin: 0 }}>{p.price != null ? `${rm(p.price)}${p.unit ? ` / ${p.unit}` : ''}` : 'no price yet'}</p>
            </div>
            <input className="login-input sb-qty" inputMode="decimal" placeholder="0" aria-label={`Quantity of ${p.item}`}
              value={qty[p.item] ?? ''} onChange={e => setQty(q => ({ ...q, [p.item]: e.target.value.replace(/[^\d.]/g, '') }))} />
          </div>
        )) : <p className="cap">No items bought from them through the app yet. Search below to add items.</p>}
        <input className="login-input" placeholder="Add another item…" value={find} onChange={e => setFind(e.target.value)} style={{ marginTop: 10 }} />
        {matches.map(p => <button key={p.item} type="button" className="chip" style={{ margin: '6px 6px 0 0' }} onClick={() => { setExtra(x => [...x, p]); setFind('') }}>+ {p.item}</button>)}

        <p className="rowlabel" style={{ margin: '14px 0 6px' }}>Delivery</p>
        <div className="chips">
          {days.map(d => <button key={d.iso} type="button" className={`chip${day === d.iso ? ' on' : ''}`} onClick={() => setDay(d.iso)}>{d.label}</button>)}
        </div>
        <p className="sb-total">Est. total · {picked.length} item{picked.length === 1 ? '' : 's'} <strong>{rm(total)}</strong></p>
        <div className="btnrow">
          <button type="button" className="btn ghost" disabled={!picked.length} onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setCopied(true) }}>{copied ? 'Copied' : 'Copy'}</button>
          <a className={`btn${picked.length ? '' : ' disabled'}`} style={{ flex: 1, textAlign: 'center' }} aria-disabled={!picked.length}
            href={picked.length ? `https://wa.me/${s.phone ? wa(s.phone) : ''}?text=${encodeURIComponent(text)}` : undefined} target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
      </div>
    </div>
  )
}

export default function SupplierBook({ suppliers, products, today, monthLabel }: { suppliers: Supplier[]; products: Product[]; today: string; monthLabel: string }) {
  const [tab, setTab] = useState<'suppliers' | 'products'>('suppliers')
  const [ordering, setOrdering] = useState<Supplier | null>(null)
  const [q, setQ] = useState('')
  const byName = new Map(suppliers.map(s => [s.name.toUpperCase(), s]))
  const shown = products.filter(p => !q.trim() || p.item.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <>
      <div className="sb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'suppliers'} className={tab === 'suppliers' ? 'on' : ''} onClick={() => setTab('suppliers')}>Suppliers · {suppliers.length}</button>
        <button type="button" role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>Products · {products.length}</button>
      </div>

      {tab === 'suppliers' ? suppliers.map(s => (
        <div className="sb-card" key={s.name}>
          <div className="sb-head">
            <span className="sb-ico" aria-hidden="true">🏪</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="doc-title">{s.name}</p>
              <p className="cap" style={{ margin: 0 }}>
                {s.bills ? `${s.bills} bill${s.bills > 1 ? 's' : ''} · ${rm(s.amount)} in ${monthLabel} · ` : ''}{s.phone ?? 'No contact on file'} <Contact s={s} />
              </p>
            </div>
          </div>
          <div className="sb-actions">
            <button type="button" onClick={() => setOrdering(s)}>🧺 Order</button>
            {s.phone ? <a href={`tel:${s.phone}`}>📞 Call</a> : <span className="off">📞 Call</span>}
            {s.phone ? <a href={`https://wa.me/${wa(s.phone)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a> : <span className="off">💬 WhatsApp</span>}
          </div>
        </div>
      )) : (
        <>
          <p className="cap">Food ingredients with their last purchase price, from every recorded bill. Items not bought through the app yet show the stock sheet price.</p>
          <input className="login-input" placeholder="Search an item…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          {shown.map(p => {
            const s = p.supplier ? byName.get(p.supplier.toUpperCase()) : undefined
            const change = p.prev && p.price != null ? ((p.price - p.prev) / p.prev) * 100 : null
            return (
              <div className="sb-card" key={p.item}>
                <div className="sb-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="doc-title">{p.item}</p>
                    <p className="cap" style={{ margin: 0 }}>
                      {p.fromSheet ? `${p.section} · stock sheet price` : `${p.supplier} · ${shortDay(p.date!)} · ${p.times > 1 ? `bought ${p.times}×` : 'first bill'}`}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p className="sb-price">{p.price != null ? rm(p.price) : '—'}</p>
                    <p className="cap" style={{ margin: 0 }}>
                      {change != null ? <span className={change > 0 ? 'sb-up' : 'sb-down'}>{change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% </span> : null}
                      {p.fromSheet ? 'SHEET' : 'LAST PRICE'}{p.unit ? ` / ${p.unit}` : ''}
                    </p>
                  </div>
                </div>
                {s ? (
                  <div className="sb-actions">
                    {s.phone ? <a href={`tel:${s.phone}`}>📞 Call</a> : <span className="off">📞 Call</span>}
                    {s.phone ? <a href={`https://wa.me/${wa(s.phone)}?text=${encodeURIComponent(`Hi ${s.name}, Mama Lek reorder: ${p.item}, qty: `)}`} target="_blank" rel="noreferrer">💬 WhatsApp reorder</a> : <span className="off">💬 WhatsApp reorder</span>}
                    <button type="button" onClick={() => setOrdering(s)}>🧺 Order</button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </>
      )}
      {ordering ? <OrderSheet s={ordering} all={products} today={today} onClose={() => setOrdering(null)} /> : null}
    </>
  )
}

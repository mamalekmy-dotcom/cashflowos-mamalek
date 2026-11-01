import Link from 'next/link'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import Stat from '@/app/_components/Stat'
import { AddItem, RemoveItem, StockFilter } from './StockForms'

export const dynamic = 'force-dynamic'

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toUpperCase()

type Count = {
  item: string
  uom: string | null
  unit_price: number
  closing_qty: number
  opening_amount: number
  bought_amount: number
  closing_amount: number
}
type Item = { id: number; area: string; section: string; name: string; uom: string | null; unit_price: number; added_by: number | null; aliases: string[] | null }
type Row = { key: string; id?: number; name: string; uom: string | null; price: number; count?: Count; removable: boolean }

// The item list, grouped the way the outlet thinks about it, with each item's count for
// the month beside it. Stock is only counted monthly, so a day shows its month's count.
// A counted item missing from the list still shows, so the totals always add up.
export default async function Stock({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const { month: askedMonth, day: askedDay } = await searchParams
  const day = /^\d{4}-\d{2}-\d{2}$/.test(askedDay ?? '') ? (askedDay as string) : ''
  const { data: latest } = await supabase.from('stock_counts').select('month').order('month', { ascending: false }).limit(1)
  const month = day ? day.slice(0, 7)
    : /^\d{4}-\d{2}$/.test(askedMonth ?? '') ? (askedMonth as string)
    : (latest?.[0]?.month as string | undefined) ?? todayISO().slice(0, 7)

  const [year, mon] = month.split('-').map(Number)
  const shift = (by: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + by, 1))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
  }
  const monthName = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const [{ data: list }, { data: counted }] = await Promise.all([
    supabase.from('stock_items').select('id, area, section, name, uom, unit_price, added_by, aliases').order('sort_order').order('id'),
    supabase.from('stock_counts').select('item, uom, unit_price, closing_qty, opening_amount, bought_amount, closing_amount').eq('month', month).order('id'),
  ])
  const items = (list ?? []) as Item[]
  const counts = (counted ?? []) as Count[]

  // The workbook's spelling changed during the year, so old names point at today's item.
  const aliases = new Map(items.flatMap(i => (i.aliases ?? []).map(a => [keyOf(a), keyOf(i.name)] as const)))
  const byName = new Map<string, Count>()
  for (const c of counts) {
    const key = aliases.get(keyOf(c.item)) ?? keyOf(c.item)
    const seen = byName.get(key)
    byName.set(key, seen ? {
      ...seen,
      closing_qty: Number(seen.closing_qty) + Number(c.closing_qty),
      closing_amount: Number(seen.closing_amount) + Number(c.closing_amount),
    } : c)
  }

  const groups = new Map<string, { area: string; section: string; rows: Row[] }>()
  const groupFor = (area: string, section: string) => {
    const id = `${area}|${section}`
    if (!groups.has(id)) groups.set(id, { area, section, rows: [] })
    return groups.get(id) as { area: string; section: string; rows: Row[] }
  }
  for (const i of items) {
    const key = keyOf(i.name)
    groupFor(i.area, i.section).rows.push({
      key, id: i.id, name: i.name, uom: i.uom, price: Number(i.unit_price), count: byName.get(key), removable: i.added_by !== null,
    })
  }
  const known = new Set(items.map(i => keyOf(i.name)))
  for (const [key, c] of byName) {
    if (known.has(key)) continue
    groupFor('OTHER', 'NOT ON YOUR LIST').rows.push({ key, name: c.item, uom: c.uom, price: Number(c.unit_price), count: c, removable: false })
  }

  const sections = [...groups.values()]
  const places = sections.filter(s => s.area !== 'OTHER').map(({ area, section }) => ({ area, section }))
  const areas = [...new Set(sections.map(s => s.area))]
  const add = (key: 'opening_amount' | 'bought_amount' | 'closing_amount') => counts.reduce((sum, c) => sum + Number(c[key]), 0)
  const opening = add('opening_amount')
  const closing = add('closing_amount')
  const isCounted = counts.some(c => Number(c.closing_qty) > 0) && closing > opening / 2

  return (
    <>
      <h1 className="ph">Stock</h1>
      <p className="cap">Month-end count from Stock 2026 · <Link href="/suppliers">Suppliers</Link></p>

      <div className="pulse-head">
        <Link className="btn ghost" href={`/stock?month=${shift(-1)}`} aria-label="Previous month">‹</Link>
        <strong>{monthName}</strong>
        <Link className="btn ghost" href={`/stock?month=${shift(1)}`} aria-label="Next month">›</Link>
      </div>

      <StockFilter month={month} day={day} />
      {day ? <p className="cap">Stock is counted once a month, so {day} shows the {monthName} count.</p> : null}

      <div className="grid">
        <Stat label="Opening stock" value={rm(opening)} />
        <Stat label="Bought" value={rm(add('bought_amount'))} />
        <Stat label="Closing stock" value={isCounted ? rm(closing) : '—'} />
        <Stat label="Items counted" value={counts.length} />
      </div>

      {!isCounted ? (
        <p className="login-error" style={{ marginBottom: 16 }}>{monthName} hasn&apos;t been counted yet, so there&apos;s no closing stock.</p>
      ) : null}

      <AddItem places={places} />

      {areas.map(area => (
        <div key={area} style={{ marginTop: 20 }}>
          <p className="rowlabel">{area}</p>
          {sections.filter(s => s.area === area).map(group => {
            const total = group.rows.reduce((sum, r) => sum + Number(r.count?.closing_amount ?? 0), 0)
            return (
              <details className="admin-card" key={group.section}>
                <summary style={{ cursor: 'pointer' }}>
                  <strong>{group.section}</strong> <span className="cap figure">· {group.rows.length} items · {rm(total)}</span>
                </summary>
                <table className="tbl" style={{ marginTop: 12 }}>
                  <thead><tr><th>Item</th><th>Unit</th><th>Unit price</th><th>Closing qty</th><th>Amount</th><th></th></tr></thead>
                  <tbody>
                    {group.rows.map(r => (
                      <tr key={r.key}>
                        <td data-label="Item">{r.name}</td>
                        <td data-label="Unit">{r.count?.uom ?? r.uom ?? ''}</td>
                        <td data-label="Amount">{rm(Number(r.count?.unit_price ?? r.price))}</td>
                        <td data-label="Closing qty">{r.count ? Number(r.count.closing_qty).toLocaleString('en-MY') : '—'}</td>
                        <td data-label="Amount">{r.count ? rm(Number(r.count.closing_amount)) : '—'}</td>
                        <td>{r.removable && r.id ? <RemoveItem id={r.id} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )
          })}
        </div>
      ))}
    </>
  )
}

import Link from 'next/link'
import { rm } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import Stat from '@/app/_components/Stat'

export const dynamic = 'force-dynamic'

const pad = (n: number) => String(n).padStart(2, '0')

type Count = {
  area: string
  section: string
  item: string
  uom: string | null
  closing_qty: number
  opening_amount: number
  bought_amount: number
  closing_amount: number
}

// Purchases by supplier and the month-end stock count, both from the Stock workbook.
// Stock value here adds every item, so it runs higher than the workbook's own TOTAL,
// which skips a few rows.
export default async function Stock({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams
  const { data: latest } = await supabase.from('stock_counts').select('month').order('month', { ascending: false }).limit(1)
  const month = /^\d{4}-\d{2}$/.test(asked ?? '') ? (asked as string) : (latest?.[0]?.month as string | undefined)

  if (!month) {
    return (
      <>
        <h1 className="ph">Stock</h1>
        <p className="cap">No stock counts loaded yet.</p>
      </>
    )
  }

  const [year, mon] = month.split('-').map(Number)
  const to = `${month}-${pad(new Date(Date.UTC(year, mon, 0)).getUTCDate())}`
  const shift = (by: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + by, 1))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
  }
  const monthName = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const [{ data: bought }, { data: counts }] = await Promise.all([
    supabase.from('purchases').select('supplier, amount').gte('purchase_date', `${month}-01`).lte('purchase_date', to),
    supabase.from('stock_counts').select('area, section, item, uom, closing_qty, opening_amount, bought_amount, closing_amount').eq('month', month).order('id'),
  ])

  const bySupplier = new Map<string, number>()
  for (const p of bought ?? []) bySupplier.set(p.supplier, (bySupplier.get(p.supplier) ?? 0) + Number(p.amount))
  const suppliers = [...bySupplier].sort((a, b) => b[1] - a[1])
  const purchased = suppliers.reduce((sum, [, amount]) => sum + amount, 0)

  const items = (counts ?? []) as Count[]
  const add = (key: 'opening_amount' | 'bought_amount' | 'closing_amount') => items.reduce((sum, i) => sum + Number(i[key]), 0)
  const opening = add('opening_amount')
  const closing = add('closing_amount')
  const counted = items.some(i => Number(i.closing_qty) > 0) && closing > opening / 2

  return (
    <>
      <h1 className="ph">Stock</h1>
      <p className="cap">Purchases and month-end count from Stock 2026 · <Link href="/suppliers">Suppliers</Link></p>

      <div className="pulse-head">
        <Link className="btn ghost" href={`/stock?month=${shift(-1)}`} aria-label="Previous month">‹</Link>
        <strong>{monthName}</strong>
        <Link className="btn ghost" href={`/stock?month=${shift(1)}`} aria-label="Next month">›</Link>
      </div>

      <div className="grid">
        <Stat label="Supplier purchases" value={rm(purchased)} />
        <Stat label="Opening stock" value={rm(opening)} />
        <Stat label="Closing stock" value={counted ? rm(closing) : '—'} />
        <Stat label="Suppliers used" value={suppliers.length} />
      </div>

      {items.length && !counted ? (
        <p className="login-error" style={{ marginBottom: 16 }}>
          {monthName} hasn&apos;t been counted yet, so there&apos;s no closing stock.
        </p>
      ) : null}

      <p className="rowlabel" style={{ marginTop: 24 }}>Spend by supplier</p>
      {suppliers.length ? (
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>Supplier</th><th>Amount</th></tr></thead>
          <tbody>
            {suppliers.map(([name, amount]) => (
              <tr key={name}>
                <td data-label="Supplier">{name}</td>
                <td data-label="Amount">{rm(amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">No purchases for {monthName}.</p>}

      <p className="rowlabel">Stock count</p>
      {items.length ? (
        <table className="tbl">
          <thead><tr><th>Item</th><th>Area</th><th>Closing qty</th><th>Amount</th></tr></thead>
          <tbody>
            {items.map((i, index) => (
              <tr key={index}>
                <td data-label="Item">{i.item}</td>
                <td data-label="Area">{[i.area, i.section].filter(Boolean).join(' · ')}</td>
                <td data-label="Closing qty">{Number(i.closing_qty).toLocaleString('en-MY')}{i.uom ? ` ${i.uom}` : ''}</td>
                <td data-label="Amount">{rm(Number(i.closing_amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">No stock count for {monthName}.</p>}
    </>
  )
}

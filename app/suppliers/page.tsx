import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { rm, todayISO } from '@/lib/records'
import { AddProduct, AddSupplier } from './SupplierForms'

export const dynamic = 'force-dynamic'

const PAGE = 1000

type Supplier = { id: number; name: string; phone: string | null }
type Product = { id: number; supplier_id: number; name: string; unit: string | null; price: number | null }

// wa.me wants digits with the country code, so a local 012... becomes 6012...
function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('0') ? `6${digits}` : digits
}

// Order opens WhatsApp with the product list ready to edit. Nothing is sent until the
// person presses send there.
function orderText(name: string, products: Product[]): string {
  const lines = products.map(p => `- ${p.name}${p.unit ? ` (${p.unit})` : ''}: `)
  return `Hi ${name}, Mama Lek order:\n${lines.join('\n')}`
}

// A year runs past Supabase's 1,000-row reply, so read it a page at a time.
async function purchasesSince(from: string): Promise<{ supplier: string; amount: number }[]> {
  const rows: { supplier: string; amount: number }[] = []
  for (let page = 0; ; page++) {
    const { data } = await supabase.from('purchases').select('supplier, amount').gte('purchase_date', from)
      .order('id').range(page * PAGE, page * PAGE + PAGE - 1)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return rows
  }
}

export default async function Suppliers() {
  const year = todayISO().slice(0, 4)
  const [{ data: suppliers }, { data: products }, { data: docs }, bought] = await Promise.all([
    supabase.from('suppliers').select('id, name, phone').order('name'),
    supabase.from('supplier_products').select('id, supplier_id, name, unit, price').order('name'),
    supabase.from('documents').select('supplier_id, amount').eq('status', 'accepted'),
    purchasesSince(`${year}-01-01`),
  ])
  const list = (suppliers ?? []) as Supplier[]
  const items = (products ?? []) as Product[]
  const spendOf = (id: number) => (docs ?? []).filter(d => d.supplier_id === id)

  const totals = new Map<string, { amount: number; orders: number }>()
  for (const p of bought) {
    const t = totals.get(p.supplier) ?? { amount: 0, orders: 0 }
    totals.set(p.supplier, { amount: t.amount + Number(p.amount), orders: t.orders + 1 })
  }
  const spend = [...totals].sort((a, b) => b[1].amount - a[1].amount)

  return (
    <>
      <h1 className="ph">Suppliers</h1>
      <p className="cap">{spend.length} suppliers bought from in {year} · {list.length} with contacts · {items.length} products · <Link href="/stock">Stock</Link></p>

      <p className="rowlabel">Spend in {year}, from Stock 2026</p>
      {spend.length ? (
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>Supplier</th><th>Lines</th><th>Amount</th></tr></thead>
          <tbody>
            {spend.map(([name, t]) => (
              <tr key={name}>
                <td data-label="Supplier">{name}</td>
                <td data-label="Lines">{t.orders}</td>
                <td data-label="Amount">{rm(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">No purchases this year.</p>}

      <p className="rowlabel">Contacts and order lists</p>
      <AddSupplier />
      {list.map(supplier => {
        const theirs = items.filter(p => p.supplier_id === supplier.id)
        const accepted = spendOf(supplier.id)
        const spend = accepted.reduce((sum, d) => sum + Number(d.amount ?? 0), 0)
        const whatsapp = supplier.phone ? whatsappNumber(supplier.phone) : ''
        return (
          <div className="admin-card" key={supplier.id}>
            <p className="rowlabel" style={{ marginBottom: 2 }}>{supplier.name}</p>
            <p className="cap figure" style={{ margin: '0 0 10px' }}>
              {accepted.length} docs · {rm(spend)} · {supplier.phone ?? 'No contact on file'}
            </p>
            {theirs.length ? (
              <ul className="cap" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                {theirs.map(p => (
                  <li key={p.id}>{p.name}{p.unit ? ` · ${p.unit}` : ''}{p.price != null ? ` · ${rm(Number(p.price))}` : ''}</li>
                ))}
              </ul>
            ) : null}
            {supplier.phone ? (
              <div className="btnrow">
                <a className="btn" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(orderText(supplier.name, theirs))}`} target="_blank" rel="noreferrer">Order</a>
                <a className="btn ghost" href={`tel:${supplier.phone}`}>Call</a>
                <a className="btn ghost" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>
              </div>
            ) : null}
            <AddProduct supplierId={supplier.id} />
          </div>
        )
      })}
    </>
  )
}

import { supabase } from '@/lib/supabase'
import { rm } from '@/lib/records'
import { AddProduct, AddSupplier } from './SupplierForms'

export const dynamic = 'force-dynamic'

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

export default async function Suppliers() {
  const [{ data: suppliers }, { data: products }, { data: docs }] = await Promise.all([
    supabase.from('suppliers').select('id, name, phone').order('name'),
    supabase.from('supplier_products').select('id, supplier_id, name, unit, price').order('name'),
    supabase.from('documents').select('supplier_id, amount').eq('status', 'accepted'),
  ])
  const list = (suppliers ?? []) as Supplier[]
  const items = (products ?? []) as Product[]
  const spendOf = (id: number) => (docs ?? []).filter(d => d.supplier_id === id)

  return (
    <>
      <h1 className="ph">Suppliers</h1>
      <p className="cap">{list.length} suppliers · {items.length} products</p>
      <AddSupplier />
      {list.map(supplier => {
        const theirs = items.filter(p => p.supplier_id === supplier.id)
        const accepted = spendOf(supplier.id)
        const spend = accepted.reduce((sum, d) => sum + Number(d.amount ?? 0), 0)
        const whatsapp = supplier.phone ? whatsappNumber(supplier.phone) : ''
        return (
          <div className="admin-card" key={supplier.id}>
            <p className="rowlabel" style={{ marginBottom: 2 }}>{supplier.name}</p>
            <p className="cap" style={{ margin: '0 0 10px' }}>
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

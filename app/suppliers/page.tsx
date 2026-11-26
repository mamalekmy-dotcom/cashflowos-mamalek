import Link from 'next/link'
import { todayISO } from '@/lib/records'
import { supplierBook } from '@/lib/supplier-book'
import SupplierBook from './SupplierBook'
import { AddSupplier } from './SupplierForms'

export const dynamic = 'force-dynamic'

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

// Suppliers, laid out like Escor: Suppliers (contacts + Order / Call / WhatsApp) and
// Products (food ingredients with their last purchase price). lib/supplier-book.ts.
export default async function Suppliers() {
  const today = todayISO()
  const { suppliers, products } = await supplierBook(today.slice(0, 7))
  return (
    <div className="doc-page">
      <p className="rowlabel" style={{ marginBottom: 0 }}>Purchase records</p>
      <h1 className="ph">Suppliers</h1>
      <p className="cap">View suppliers and the food you buy from them. Tap Call or WhatsApp, or Order to write the message for you. Spend by month: <Link href="/stock">Stock</Link>.</p>
      <SupplierBook suppliers={suppliers} products={products} today={today} monthLabel={monthName(today.slice(0, 7))} />
      <div style={{ marginTop: 16 }}><AddSupplier /></div>
    </div>
  )
}

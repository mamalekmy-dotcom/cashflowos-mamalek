import 'server-only'
import { supabase } from './supabase'
import { NOT_STOCK } from './stock-logic'

// The Suppliers page, laid out like Escor's: a Suppliers tab (contact, this month's bills,
// Order / Call / WhatsApp) and a Products tab (every food ingredient with its last
// purchase price). Prices come from every recorded bill; an item never bought through
// the app shows the stock sheet's price.

// Stock-sheet sections that aren't food (packaging, gas, cleaning...).
const NOT_FOOD = /OTHERS|PACKAGING/i

export type Product = {
  item: string; section: string; unit: string; price: number | null; prev: number | null; date: string | null
  supplier: string | null; times: number; fromSheet: boolean
}
export type SupplierCard = { name: string; phone: string | null; bills: number; amount: number; products: Product[] }

type Line = { item?: string; qty?: number | null; unit?: string; price?: number | null }
const PAGE = 1000

async function readAll<T>(page: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await page(a, a + PAGE - 1)
    if (error) throw new Error(error.message)
    const got = (data ?? []) as T[]
    out.push(...got)
    if (got.length < PAGE) return out
  }
}

export async function supplierBook(month: string) {
  const [{ data: last }, bills, { data: contacts }, buys] = await Promise.all([
    supabase.from('stock_counts').select('month').order('month', { ascending: false }).limit(1).maybeSingle(),
    readAll<{ id: number; payload: any; result: any }>((a, b) => supabase.from('agent_actions').select('id, payload, result')
      .eq('agent_key', 'stock-receipt').eq('status', 'executed').order('id').range(a, b)),
    supabase.from('suppliers').select('id, name, phone').order('name'),
    readAll<{ supplier: string; amount: number }>((a, b) => supabase.from('purchases').select('supplier, amount')
      .gte('purchase_date', `${month}-01`).lte('purchase_date', `${month}-31`).order('id').range(a, b)),
  ])
  const sheet = last?.month
    ? await readAll<{ section: string; item: string; uom: string | null; unit_price: number | null }>((a, b) => supabase.from('stock_counts')
      .select('section, item, uom, unit_price').eq('month', last.month).order('id').range(a, b))
    : []

  // Every food item on the stock sheet.
  const food = new Map<string, Product>()
  for (const r of sheet) {
    if (NOT_FOOD.test(r.section) || !r.item) continue
    food.set(r.item.toUpperCase(), {
      item: r.item, section: r.section, unit: r.uom ?? '', price: r.unit_price != null ? Number(r.unit_price) : null, prev: null,
      date: null, supplier: null, times: 0, fromSheet: true,
    })
  }

  // Bill lines, oldest first, so the last one seen is the last price.
  const live = bills.filter(b => b.result?.kind === 'stock_receipt' && !b.result?.removed)
    .sort((x, y) => String(x.payload?.date).localeCompare(String(y.payload?.date)) || x.id - y.id)
  for (const b of live) {
    for (const l of (b.payload?.lines ?? []) as Line[]) {
      if (!l.item || l.item === NOT_STOCK || l.price == null) continue
      const p = food.get(l.item.toUpperCase())
      if (!p) continue // not food, or no longer on the sheet
      if (!p.fromSheet && p.price != null && Math.abs(p.price - Number(l.price)) > 0.001) p.prev = p.price
      p.price = Number(l.price)
      p.unit = l.unit || p.unit
      p.date = String(b.payload.date)
      p.supplier = String(b.payload.supplier)
      p.times++
      p.fromSheet = false
    }
  }
  const products = [...food.values()].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '') || a.item.localeCompare(b.item))

  // Suppliers: the ones with contacts, plus anyone billed this month or seen on a bill.
  const key = (s: string) => s.trim().toUpperCase()
  const cards = new Map<string, SupplierCard>()
  const card = (name: string) => {
    const k = key(name)
    if (!cards.has(k)) cards.set(k, { name: name.trim(), phone: null, bills: 0, amount: 0, products: [] })
    return cards.get(k)!
  }
  for (const c of contacts ?? []) card(c.name).phone = c.phone
  for (const b of buys) { const c = card(b.supplier); c.bills++; c.amount += Number(b.amount) || 0 }
  for (const p of products) if (p.supplier) card(p.supplier).products.push(p)
  for (const b of live) card(String(b.payload.supplier))
  const suppliers = [...cards.values()].filter(c => c.name && c.name !== 'OTHERS')
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))

  return { suppliers, products }
}

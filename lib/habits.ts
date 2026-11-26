import 'server-only'
import { supabase } from './supabase'
import { NOT_STOCK, normal, type LogRow } from './stock-logic'

// What the bot learns from every recorded bill, so it asks less over time:
//  • each supplier's usual items (a misread line matched to what they always sell)
//  • each supplier's invoice number pattern (SG26-15xxxx), to fix one-character misreads
//  • each item's normal price range (vegetables swing week to week)
//  • each supplier's usual order: which items, how much, and on which weekdays
// Read from executed stock-receipt actions (not undone).

export type PastLine = { supplier: string; text: string; item: string; qty: number; unit: string; price: number | null; date: string; invoice: string }
type PastBill = { supplier: string; date: string; invoice: string; lines: PastLine[] }

const PAGE = 1000
export async function pastBills(days = 120): Promise<PastBill[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const rows: { payload: any; result: any }[] = []
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await supabase.from('agent_actions').select('payload, result')
      .eq('agent_key', 'stock-receipt').eq('status', 'executed').gte('proposed_at', since).order('id').range(a, a + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as any[]))
    if ((data ?? []).length < PAGE) break
  }
  return rows.filter(r => r.result?.kind === 'stock_receipt' && !r.result?.removed).map(r => {
    const p = r.payload ?? {}
    const supplier = String(p.supplier || '')
    return {
      supplier, date: String(p.date || ''), invoice: String(p.invoice || ''),
      lines: ((p.lines ?? []) as any[]).filter(l => l.item).map(l => ({
        supplier, text: String(l.text || ''), item: String(l.item), qty: Number(l.qty) || 0, unit: String(l.unit || ''),
        price: l.price == null ? null : Number(l.price), date: String(p.date || ''), invoice: String(p.invoice || ''),
      })),
    }
  })
}

// ------------------------------------------------------------------ usual items
// Letters-and-digits similarity (Dice on character pairs): "KOBIS PJG" vs "KOBIS PANJANG".
function similar(a: string, b: string): number {
  const pairs = (s: string) => { const t = normal(s).replace(/ /g, ''); const out: string[] = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out }
  const x = pairs(a), y = pairs(b)
  if (!x.length || !y.length) return 0
  const pool = [...y]
  let hit = 0
  for (const p of x) { const i = pool.indexOf(p); if (i >= 0) { hit++; pool.splice(i, 1) } }
  return (2 * hit) / (x.length + y.length)
}

// The item this supplier's line most likely is, from what they sold before. Only when one
// item clearly wins (similar text before, and no other item close behind).
export function usualItemFor(history: PastBill[], supplier: string, text: string): string | null {
  const theirs = history.filter(b => b.supplier === supplier).flatMap(b => b.lines)
  if (!theirs.length || !normal(text)) return null
  const best = new Map<string, number>()
  for (const l of theirs) {
    const s = similar(text, l.text)
    if (s > (best.get(l.item) ?? 0)) best.set(l.item, s)
  }
  const ranked = [...best].sort((a, b) => b[1] - a[1])
  const [top, next] = ranked
  if (!top || top[1] < 0.72) return null
  if (next && next[1] > top[1] - 0.15) return null
  return top[0]
}

// ------------------------------------------------------------------ invoice numbers
const inv = (s: string) => normal(s).replace(/ /g, '')
// The part every recent invoice from this supplier shares ("SG26" from SG26-151219, SG26-152004).
function sharedPrefix(nos: string[]): string {
  if (nos.length < 3) return ''
  let p = nos[0]
  for (const n of nos) while (p && !n.startsWith(p)) p = p.slice(0, -1)
  return p.length >= 2 ? p : ''
}

// A one-character misread of the supplier's usual prefix, put right: SG25-151219 → SG26-151219
// when their last bills all start SG26. Null when nothing to fix.
export function fixInvoice(history: PastBill[], supplier: string, invoice: string): string | null {
  const no = inv(invoice)
  if (no.length < 4) return null
  const recent = history.filter(b => b.supplier === supplier && inv(b.invoice).length >= 4).slice(-6).map(b => inv(b.invoice))
  const prefix = sharedPrefix(recent)
  if (!prefix || no.startsWith(prefix) || recent.some(r => r.length !== no.length)) return null
  const head = no.slice(0, prefix.length)
  let diff = 0
  for (let i = 0; i < prefix.length; i++) if (head[i] !== prefix[i]) diff++
  if (diff !== 1) return null
  // Keep the bill's own punctuation: swap the one wrong character in the printed text.
  let seen = 0
  let out = ''
  for (const ch of invoice) {
    if (/[A-Za-z0-9]/.test(ch) && seen < prefix.length) { out += normal(ch) === head[seen] && head[seen] !== prefix[seen] ? prefix[seen] : ch; seen++ }
    else out += ch
  }
  return out
}

// ------------------------------------------------------------------ price ranges
// The highest normal price for an item: the top of its last 90 days on the Receipt Log
// (same unit), when there are at least 3 prices. Null = not enough history, use the 5% rule.
export function normalTop(log: LogRow[], item: string, unit: string, date: string): number | null {
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10)
  const prices = log.filter(l => l.item === item && l.price > 0 && (!unit || !l.unit || l.unit === unit) && l.date >= from && l.date <= date).map(l => l.price)
  return prices.length >= 3 ? Math.max(...prices) : null
}

// ------------------------------------------------------------------ usual orders
export type UsualOrder = { supplier: string; days: number[]; items: { item: string; qty: number; unit: string }[] }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday

// Per supplier, from the last 8 weeks: the weekdays they usually deliver (2+ times), and the
// items in at least half their bills with the median quantity.
export function usualOrders(history: PastBill[], today: string): UsualOrder[] {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 56 * 86_400_000).toISOString().slice(0, 10)
  const bySupplier = new Map<string, PastBill[]>()
  for (const b of history) if (b.date >= from && b.supplier && b.supplier !== 'OTHERS') bySupplier.set(b.supplier, [...(bySupplier.get(b.supplier) ?? []), b])
  const out: UsualOrder[] = []
  for (const [supplier, bills] of bySupplier) {
    const dates = [...new Set(bills.map(b => b.date))]
    const perDow = new Map<number, number>()
    for (const d of dates) perDow.set(dowOf(d), (perDow.get(dowOf(d)) ?? 0) + 1)
    const days = [...perDow].filter(([, n]) => n >= 2).map(([d]) => d).sort()
    const lines = bills.flatMap(b => b.lines.filter(l => l.item !== NOT_STOCK && l.qty > 0))
    const byItem = new Map<string, PastLine[]>()
    for (const l of lines) byItem.set(l.item, [...(byItem.get(l.item) ?? []), l])
    const items = [...byItem].filter(([, ls]) => new Set(ls.map(l => l.date)).size >= Math.max(1, Math.ceil(dates.length / 2)))
      .map(([item, ls]) => ({ item, qty: Math.round(median(ls.map(l => l.qty)) * 100) / 100, unit: ls[ls.length - 1].unit }))
    out.push({ supplier, days, items })
  }
  return out
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

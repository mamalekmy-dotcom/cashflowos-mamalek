import 'server-only'
import { supabase, supabaseConfigured } from './supabase'
import { rm as rmExact } from './records'
import { FINANCE_HEAD as F } from '@/agents/finance-head/definition'
import * as say from '@/agents/finance-head/prompt'
import type { Suggestion } from '@/agents/finance-head/prompt'
import type { ProposalDraft } from '@/agents/registry'

// The Head of Finance: reads sales, purchases and the monthly P&L, and checks them
// against the lines in agents/finance-head/definition.ts. Read-only here. The cron turns
// the biggest alarm into ONE proposal a day; the AI C Suite tab shows every reading.

export type AlarmKind = 'sales' | 'supplier' | 'month' | 'buying'
export type Alarm = { key: string; kind: AlarmKind; impact: number; s: Suggestion }
export type Reading = { kind: AlarmKind | 'wastage'; label: string; value: string; line: string; state: 'firing' | 'ok' | 'nodata' }

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const rm = (n: number) => rmExact(Math.round(n))
const pct = (n: number) => `${n.toFixed(1)}%`
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

const PAGE = 1000
async function readAll<T>(page: (first: number, last: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let first = 0; ; first += PAGE) {
    const { data, error } = await page(first, first + PAGE - 1)
    if (error) throw new Error(error.message)
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < PAGE) return rows
  }
}

type Sale = { sale_date: string; net_sales: number }
type Buy = { purchase_date: string; supplier: string; amount: number }

export async function financeReadout(today: string): Promise<{ readings: Reading[]; alarms: Alarm[] }> {
  const readings: Reading[] = []
  const alarms: Alarm[] = []
  if (!supabaseConfigured) return { readings, alarms }

  const since = addDays(today, -130)
  const [sales, buys, { data: pnl }] = await Promise.all([
    readAll<Sale>((a, b) => supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', since).lt('sale_date', today).order('sale_date').range(a, b)),
    readAll<Buy>((a, b) => supabase.from('purchases').select('purchase_date, supplier, amount').gte('purchase_date', addDays(today, -120)).lt('purchase_date', today).order('id').range(a, b)),
    // The last month with a TMS report, from before this month.
    supabase.from('monthly_pnl').select('month, net_sales, cogs, labor').lt('month', today.slice(0, 7)).order('month', { ascending: false }).limit(1).maybeSingle(),
  ])
  const salesOn = new Map(sales.map(s => [s.sale_date, Number(s.net_sales)]))

  // ① Sales drop — yesterday vs the last 4 same weekdays.
  const yday = addDays(today, -1)
  const actual = salesOn.get(yday) ?? 0
  const past = [7, 14, 21, 28].map(n => salesOn.get(addDays(yday, -n)) ?? 0).filter(v => v > 0)
  if (actual > 0 && past.length >= 3) {
    const usual = sum(past) / past.length
    const dropPct = (1 - actual / usual) * 100
    const firing = dropPct >= F.salesDropPct
    readings.push({ kind: 'sales', label: 'Sales drop', value: `${rm(actual)} vs usual ${rm(usual)}`, line: `${F.salesDropPct}% below`, state: firing ? 'firing' : 'ok' })
    if (firing) alarms.push({ key: `${F.key}:sales:${yday}`, kind: 'sales', impact: usual - actual, s: say.salesDrop({ date: yday, actual, usual, dropPct }) })
  } else {
    readings.push({ kind: 'sales', label: 'Sales drop', value: actual > 0 ? 'Not enough past weeks' : 'No sales logged yesterday', line: `${F.salesDropPct}% below`, state: 'nodata' })
  }

  // ② Supplier spend jump — last 30 days vs the average 30 days before that.
  const recentFrom = addDays(today, -30)
  const usualFrom = addDays(today, -120)
  const bySupplier = new Map<string, { name: string; recent: number; before: number }>()
  for (const b of buys) {
    const id = b.supplier.trim().toUpperCase()
    const s = bySupplier.get(id) ?? { name: b.supplier.trim(), recent: 0, before: 0 }
    if (b.purchase_date >= recentFrom) s.recent += Number(b.amount)
    else if (b.purchase_date >= usualFrom) s.before += Number(b.amount)
    bySupplier.set(id, s)
  }
  const jumps = [...bySupplier.values()]
    .map(s => ({ ...s, usual: s.before / 3 }))
    .filter(s => s.usual > 0 && s.recent >= s.usual * (1 + F.supplierJumpPct / 100) && s.recent - s.usual >= F.supplierJumpRM)
  readings.push({
    kind: 'supplier', label: 'Supplier spend jumps',
    value: buys.length ? `${jumps.length} of ${bySupplier.size} suppliers` : 'No purchases yet',
    line: `+${F.supplierJumpPct}% and +${rm(F.supplierJumpRM)}`, state: !buys.length ? 'nodata' : jumps.length ? 'firing' : 'ok',
  })
  for (const j of jumps) {
    alarms.push({
      key: `${F.key}:supplier:${j.name.toUpperCase()}:${today.slice(0, 7)}`, kind: 'supplier', impact: j.recent - j.usual,
      s: say.supplierJump({ supplier: j.name, recent: j.recent, usual: j.usual, upPct: (j.recent / j.usual - 1) * 100 }),
    })
  }

  // ③ Monthly cost alarm — labour keyed in on the FLR page wins over the TMS figure.
  if (pnl && Number(pnl.net_sales) > 0) {
    const { data: keyed } = await supabase.from('monthly_costs').select('labour').eq('month', pnl.month).maybeSingle()
    const sales = Number(pnl.net_sales)
    const labour = keyed ? Number(keyed.labour) : Number(pnl.labor)
    const labourPct = labour > 0 ? (labour / sales) * 100 : null
    const foodPct = Number(pnl.cogs) > 0 ? (Number(pnl.cogs) / sales) * 100 : null
    const over: string[] = []
    let impact = 0
    if (labourPct != null && labourPct > F.labourLinePct) { over.push('labour'); impact += (labourPct - F.labourLinePct) / 100 * sales }
    if (foodPct != null && foodPct > F.foodLinePct) { over.push('food cost'); impact += (foodPct - F.foodLinePct) / 100 * sales }
    readings.push({
      kind: 'month', label: `Monthly costs (${pnl.month})`,
      value: `Labour ${labourPct != null ? pct(labourPct) : '—'} · Food ${foodPct != null ? pct(foodPct) : '—'}`,
      line: `${F.labourLinePct}% · ${F.foodLinePct}%`, state: over.length ? 'firing' : 'ok',
    })
    if (over.length) alarms.push({ key: `${F.key}:month:${pnl.month}`, kind: 'month', impact, s: say.monthlyCost({ month: pnl.month, sales, labourPct, foodPct, over }) })
  } else {
    readings.push({ kind: 'month', label: 'Monthly costs', value: 'No TMS report yet', line: `${F.labourLinePct}% · ${F.foodLinePct}%`, state: 'nodata' })
  }

  // ④ Buying too much — last 30 days of purchases vs last 30 days of sales.
  const bought = sum(buys.filter(b => b.purchase_date >= recentFrom).map(b => Number(b.amount)))
  const sold = sum(sales.filter(s => s.sale_date >= recentFrom).map(s => Number(s.net_sales)))
  if (sold > 0) {
    const buyPct = (bought / sold) * 100
    const firing = buyPct > F.buyingLinePct
    readings.push({ kind: 'buying', label: 'Buying vs sales', value: `${pct(buyPct)} (${rm(bought)})`, line: `${F.buyingLinePct}%`, state: firing ? 'firing' : 'ok' })
    if (firing) alarms.push({ key: `${F.key}:buying:${today.slice(0, 7)}`, kind: 'buying', impact: (buyPct - F.buyingLinePct) / 100 * sold, s: say.buyingTooMuch({ bought, sales: sold, buyPct }) })
  } else {
    readings.push({ kind: 'buying', label: 'Buying vs sales', value: 'No sales in the last 30 days', line: `${F.buyingLinePct}%`, state: 'nodata' })
  }

  readings.push({ kind: 'wastage', label: 'Wastage %', value: 'Next upgrade: needs a wastage log', line: `${F.wastageLinePct}%`, state: 'nodata' })

  alarms.sort((a, b) => b.impact - a.impact)
  return { readings, alarms }
}

// Telegram messages are HTML, and supplier names carry & signs.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The daily check. ONE proposal: the biggest alarm not already brought to you. The rest
// are named underneath so nothing is hidden, and come up on later days if still true.
export async function financeCheck(today: string): Promise<ProposalDraft[]> {
  const { alarms } = await financeReadout(today)
  if (!alarms.length) return []
  const { data } = await supabase.from('agent_actions').select('idempotency_key').in('idempotency_key', alarms.map(a => a.key))
  const asked = new Set((data ?? []).map(r => r.idempotency_key as string))
  const fresh = alarms.filter(a => !asked.has(a.key))
  if (!fresh.length) return []

  const [top, ...rest] = fresh
  const also = rest.slice(0, 3).map(a => `• ${esc(a.s.title)}`).join('\n')
  const text =
    `💰 <b>Head of Finance</b>\n<b>${esc(top.s.title)}</b>\n${esc(top.s.why)}\n\n` +
    `👉 ${esc(top.s.suggest)}\n\n` +
    `Approve = I add a task and give you a draft for ${esc(top.s.to)}. Nothing is sent.` +
    (also ? `\n\n<i>Also on my radar:</i>\n${also}` : '')

  return [{
    idempotencyKey: top.key,
    text,
    payload: {
      alarm: top.kind,
      note: `${top.s.title}. ${top.s.suggest}`,
      task: { title: top.s.task, due_date: addDays(today, F.taskDueDays) },
      to: top.s.to,
      channel: 'whatsapp',
      text: top.s.draft,
    },
  }]
}

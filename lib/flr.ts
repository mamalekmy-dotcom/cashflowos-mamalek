import 'server-only'
import { NOT_STOCK } from './stock-logic'
import { supabase } from './supabase'
import { inCogs } from './cogs-rule'

// FLR = food + labour + rental as a share of nett sales. Under 70% is healthy,
// exactly 70% is on the border, over 70% is unhealthy.
export const FLR_LIMIT = 70

export const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const isFood = inCogs

// Salaries are paid early the next month, so a month's labour (and its rental, keyed
// with it) is only known then. Until then the last month with real figures stands in,
// marked as an estimate, so the FLR isn't food cost alone.
export const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
export async function lastKnownCosts(before: string): Promise<{ month: string; labour: number; rent: number } | null> {
  const [{ data: keyed }, { data: tms }] = await Promise.all([
    supabase.from('monthly_costs').select('month, labour, rent').lt('month', before).gt('labour', 0).order('month', { ascending: false }).limit(1),
    supabase.from('monthly_pnl').select('month, labor, rent').lt('month', before).gt('labor', 0).order('month', { ascending: false }).limit(1),
  ])
  const k = keyed?.[0]
  const t = tms?.[0]
  if (k && (!t || k.month >= t.month)) return { month: k.month, labour: Number(k.labour), rent: Number(k.rent) }
  return t ? { month: t.month, labour: Number(t.labor), rent: Number(t.rent) } : null
}

export type FlrHealth = 'healthy' | 'border' | 'unhealthy'
export function flrHealth(percent: number): FlrHealth {
  const shown = Math.round(percent * 10) / 10 // judged on the figure shown on screen
  return shown < FLR_LIMIT ? 'healthy' : shown === FLR_LIMIT ? 'border' : 'unhealthy'
}

// Food, labour and rental against nett sales for one month.
// Food: once the month's stock count is marked done (COGS Report), its COGS: opening +
// purchases − closing, gas counted but the rest of OTHERS left out, the same figure as the COGS Report and the
// Dashboard. Before that, ingredient lines on bills approved on Telegram (items sorted
// into Others are left out), or with none of those, the food purchases in Stock 2026.
// Labour and rental: keyed in on the FLR page; a month not keyed in uses the TMS report.
export async function flrFor(month: string, today: string) {
  const from = `${month}-01`
  const to = `${month}-${String(daysIn(month)).padStart(2, '0')}`
  const [{ data: sales }, { data: bills }, { data: stock }, { data: keyed }, { data: tms }, { data: items }, { data: counted }] = await Promise.all([
    supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', from).lte('sale_date', to),
    supabase.from('agent_actions').select('payload').eq('agent_key', 'stock-receipt').eq('status', 'executed')
      .gte('payload->>date', from).lte('payload->>date', to),
    supabase.from('stock_counts').select('section, item, opening_amount, bought_amount, closing_amount').eq('month', month),
    supabase.from('monthly_costs').select('labour, rent').eq('month', month).maybeSingle(),
    supabase.from('monthly_pnl').select('net_sales, labor, rent').eq('month', month).maybeSingle(),
    supabase.from('stock_items').select('name, section'),
    supabase.from('stock_closed').select('month').eq('month', month).maybeSingle(),
  ])

  const days = sales ?? []
  const posSales = days.reduce((s, r) => s + Number(r.net_sales), 0)
  const netSales = posSales || Number(tms?.net_sales ?? 0)

  // Stock items in the OTHERS section other than gas (gloves, detergent) aren't food cost.
  const notFood = new Set((items ?? []).filter(i => !isFood(i.section, i.name)).map(i => i.name as string))
  const foodLines = (bills ?? []).map(b => ((b.payload?.lines ?? []) as { item?: string; amount?: number }[])
    .filter(l => l.item && l.item !== NOT_STOCK && !notFood.has(l.item)))
  const foodBills = foodLines.filter(lines => lines.length).length
  const billFood = foodLines.flat().reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const sheetFood = (stock ?? []).filter(r => isFood(r.section, r.item)).reduce((s, r) => s + Number(r.bought_amount), 0)
  const cogs = (stock ?? []).filter(r => isFood(r.section, r.item))
    .reduce((s, r) => s + Number(r.opening_amount) + Number(r.bought_amount) - Number(r.closing_amount), 0)
  const food = counted ? cogs : foodBills ? billFood : sheetFood
  const foodFrom = counted
    ? 'COGS from the stock count (opening + purchases − closing)'
    : foodBills
      ? `${foodBills} bill${foodBills === 1 ? '' : 's'} approved on Telegram, ingredients only`
      : sheetFood ? 'food purchases in Stock 2026' : 'no ingredient bills yet'

  const guess = keyed || tms ? null : await lastKnownCosts(month)
  const fullLabour = keyed ? Number(keyed.labour) : tms ? Number(tms.labor ?? 0) : guess?.labour ?? 0
  const fullRent = keyed ? Number(keyed.rent) : tms ? Number(tms.rent ?? 0) : guess?.rent ?? 0
  const estimatedFrom = guess ? monthName(guess.month) : null
  const costsFrom = keyed ? 'keyed in' : tms ? 'from the TMS report'
    : guess ? `an estimate from ${estimatedFrom} until this month's salaries are keyed in` : 'not keyed in yet'

  // This month is still running, so labour and rental count only for the days with sales
  // so far. Otherwise a full month's wages sit against two days of sales.
  const running = month === today.slice(0, 7)
  const lastDay = days.reduce((d, r) => (r.sale_date > d ? r.sale_date : d), '')
  const daysSoFar = running ? (lastDay ? Number(lastDay.slice(8, 10)) : 0) : daysIn(month)
  const share = daysSoFar / daysIn(month)
  const labour = fullLabour * share
  const rent = fullRent * share
  const flr = food + labour + rent

  return {
    netSales, food, foodFrom, costsFrom, running, daysSoFar,
    keyedLabour: keyed ? Number(keyed.labour) : null, keyedRent: keyed ? Number(keyed.rent) : null, estimatedFrom,
    fullLabour, fullRent, labour, rent, flr,
    flrPercent: netSales ? (flr / netSales) * 100 : null,
  }
}

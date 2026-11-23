import 'server-only'
import { cache } from 'react'
import { supabase } from './supabase'
import { inCogs } from './cogs-rule'
import { daysIn, lastKnownCosts, monthName } from './flr'
import { FOOD_BASIS_LABEL, foodRates } from './daily-cogs'
import { posConfigured, posDays } from './geniuspos'

// The Dashboard's figures for any picked day. Each section (sales, FLR, costs) has its own
// day. daily_sales holds the POS days synced each morning; a day not in it yet (today, or
// yesterday before the morning sync) is read live from GeniusPOS and not saved.

export type Takings = { nett: number; service: number; sst: number }
type SaleRow = { sale_date: string; net_sales: number; service_charge: number; sst: number }

const round = (x: number) => Math.round(x * 100) / 100
const add = (rows: SaleRow[]): Takings =>
  rows.reduce((t, r) => ({ nett: t.nett + Number(r.net_sales), service: t.service + Number(r.service_charge), sst: t.sst + Number(r.sst) }),
    { nett: 0, service: 0, sst: 0 })
const plus = (a: Takings, b: Takings | null): Takings =>
  b ? { nett: a.nett + b.nett, service: a.service + b.service, sst: a.sst + b.sst } : a

// One day's takings straight from GeniusPOS, the same sums the morning sync saves.
// null when the POS isn't set up or can't be reached.
export const liveDay = cache(async (day: string): Promise<{ t: Takings | null; error?: string }> => {
  if (!posConfigured()) return { t: null, error: 'POS not connected' }
  try {
    const [d] = await posDays(day, day)
    if (!d || !d.receipts) return { t: { nett: 0, service: 0, sst: 0 } }
    return { t: { nett: round(d.grand_total - d.tax + d.discount - d.rounding), service: d.service_charge, sst: d.sst } }
  } catch (e: any) {
    return { t: null, error: e?.message || String(e) }
  }
})

// Sales rows from 1 Jan to the day, and whether the day itself is in daily_sales.
async function salesRows(day: string) {
  const { data } = await supabase.from('daily_sales').select('sale_date, net_sales, service_charge, sst')
    .gte('sale_date', `${day.slice(0, 4)}-01-01`).lte('sale_date', day).order('sale_date').limit(400)
  return (data ?? []) as SaleRow[]
}

// The live reading for a day that the morning sync hasn't saved yet.
async function liveIfMissing(day: string, rows: SaleRow[], today: string) {
  if (rows.some(r => r.sale_date === day) || day > today) return { live: false, t: null as Takings | null, error: undefined as string | undefined }
  // Only recent days are worth a live read; an older day missing from daily_sales had no sales.
  const recent = Date.parse(today) - Date.parse(day) <= 3 * 86_400_000
  if (!recent) return { live: false, t: null, error: undefined }
  const r = await liveDay(day)
  return { live: true, t: r.t, error: r.error }
}

// Sales Overview: the day, the month so far and the year so far (from 1 Jan), each up to
// and including the day. Months of the year with no POS days use the TMS report's nett
// sales; those have no service charge or SST split, so `tmsMonths` lists them for a note.
export async function salesOverview(day: string, today: string) {
  const rows = await salesRows(day)
  const now = await liveIfMissing(day, rows, today)
  const month = day.slice(0, 7)
  const dayRow = rows.find(r => r.sale_date === day)
  const monthRows = rows.filter(r => r.sale_date.startsWith(month))

  const posMonths = new Set(rows.map(r => r.sale_date.slice(0, 7)))
  const { data: tms } = await supabase.from('monthly_pnl').select('month, net_sales')
    .gte('month', `${day.slice(0, 4)}-01`).lt('month', month)
  const tmsMonths = (tms ?? []).filter(t => !posMonths.has(t.month) && Number(t.net_sales) > 0)
  const year = plus(add(rows), now.t)
  year.nett += tmsMonths.reduce((s, t) => s + Number(t.net_sales), 0)

  return {
    day,
    live: now.live,
    liveError: now.error,
    dayTakings: dayRow ? add([dayRow]) : now.t,
    monthTakings: plus(add(monthRows), now.t),
    monthDays: monthRows.length + (now.t && now.t.nett > 0 ? 1 : 0),
    yearTakings: year,
    tmsMonths: tmsMonths.map(t => t.month as string).sort(),
  }
}

// Food, labour and rental for the month of the day, from the 1st up to the day, against
// the nett sales for those days. Used for both FLR and Costs on the Dashboard.
// Food: a month whose stock count is done (COGS Report) has a real COGS, shared out over
// the month by sales; otherwise nett sales x the month's food cost % (Daily COGS), an
// estimate until the count is done. Labour and rental: the month's keyed-in figure (FLR
// page), else the TMS report, counted for the days up to the day.
export async function costsUpTo(day: string, today: string) {
  const month = day.slice(0, 7)
  const monthEnd = `${month}-${String(daysIn(month)).padStart(2, '0')}`
  const [{ data: sales }, { data: stock }, { data: keyed }, { data: tms }, { data: counted }, rateFor] = await Promise.all([
    supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', `${month}-01`).lte('sale_date', monthEnd),
    supabase.from('stock_counts').select('section, item, opening_amount, bought_amount, closing_amount').eq('month', month),
    supabase.from('monthly_costs').select('labour, rent').eq('month', month).gt('labour', 0).maybeSingle(),
    supabase.from('monthly_pnl').select('net_sales, labor, rent').eq('month', month).maybeSingle(),
    supabase.from('stock_closed').select('month').eq('month', month).maybeSingle(),
    foodRates(),
  ])
  const all = sales ?? []
  const upTo = all.filter(r => r.sale_date <= day)
  let live = false
  let liveNet = 0
  if (!upTo.some(r => r.sale_date === day) && day <= today && Date.parse(today) - Date.parse(day) <= 3 * 86_400_000) {
    const r = await liveDay(day)
    if (r.t) { live = true; liveNet = r.t.nett }
  }

  const dayNo = Number(day.slice(8, 10))
  const share = dayNo / daysIn(month)
  const pos = upTo.reduce((s, r) => s + Number(r.net_sales), 0) + liveNet
  const posMonth = all.reduce((s, r) => s + Number(r.net_sales), 0) + liveNet
  // No POS days in the month: the TMS report's nett sales, shared out by days.
  const netSales = posMonth ? pos : Number(tms?.net_sales ?? 0) * share

  let food: number
  let foodFrom: string
  let foodNote = ''
  if (counted) {
    const cogs = (stock ?? []).filter(r => inCogs(r.section, r.item))
      .reduce((s, r) => s + Number(r.opening_amount) + Number(r.bought_amount) - Number(r.closing_amount), 0)
    const part = posMonth ? pos / posMonth : share
    food = cogs * part
    foodFrom = part >= 0.9999 ? 'stock count' : 'stock count, shared by sales'
  } else {
    const rate = rateFor(month)
    food = netSales * rate.rate
    foodFrom = `estimate, ${(rate.rate * 100).toFixed(1)}% of sales`
    foodNote = `Food cost is an estimate until this month's stock count is done: nett sales x ${(rate.rate * 100).toFixed(1)}%, ${FOOD_BASIS_LABEL[rate.basis]}.`
  }

  // Salaries come early next month; until then last month's stand in, marked as an estimate.
  const guess = keyed || tms ? null : await lastKnownCosts(month)
  const fullLabour = keyed ? Number(keyed.labour) : tms ? Number(tms.labor ?? 0) : guess?.labour ?? 0
  const fullRent = keyed ? Number(keyed.rent) : tms ? Number(tms.rent ?? 0) : guess?.rent ?? 0
  const estimatedFrom = guess ? monthName(guess.month) : null
  const labour = fullLabour * share
  const rent = fullRent * share
  const total = food + labour + rent
  return {
    day, month, dayNo, days: daysIn(month), live,
    netSales: round(netSales), food: round(food), foodFrom, foodNote, labour: round(labour), rent: round(rent), total: round(total),
    costsKeyed: Boolean(keyed || tms || guess), estimatedFrom,
    flrPercent: netSales ? (total / netSales) * 100 : null,
  }
}

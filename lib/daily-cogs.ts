import 'server-only'
import { supabase } from './supabase'
import { todayISO } from './records'

// Daily food cost. Stock is counted once a month, so a single day's real usage isn't
// known. Each day gets its share: POS sales before tax x that month's food cost %.
// A counted month's days add up to its food used (opening + bought - closing), where
// closing is next month's opening. The % is the same every day, so this can't show a
// bad day in the kitchen. Purchases are the real daily figure.

export type FoodBasis = 'counted' | 'estimated_closing' | 'average'
export const FOOD_BASIS_LABEL: Record<FoodBasis, string> = {
  counted: 'from the monthly stock count',
  estimated_closing: 'estimated, closing count not in yet, using average closing stock',
  average: 'estimated, using the average of counted months',
}

export type FoodDay = { date: string; sales: number; food_cost: number; purchases: number }

const PAGE = 1000
async function readAll<T>(
  page: (first: number, last: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let first = 0; ; first += PAGE) {
    const { data, error } = await page(first, first + PAGE - 1)
    if (error) throw new Error(error.message)
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < PAGE) return rows
  }
}

const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}

// Each month's food cost % of POS sales before tax, and how it was reached. OTHERS and
// PACKAGING aren't food. Months without a count borrow from the counted ones.
async function foodRates() {
  const [stock, sales] = await Promise.all([
    readAll<{ month: string; section: string; opening_amount: number; bought_amount: number }>((a, b) =>
      supabase.from('stock_counts').select('month, section, opening_amount, bought_amount').order('id').range(a, b)),
    readAll<{ sale_date: string; net_sales: number }>((a, b) =>
      supabase.from('daily_sales').select('sale_date, net_sales').order('sale_date').range(a, b)),
  ])

  const opening = new Map<string, number>()
  const bought = new Map<string, number>()
  for (const r of stock) {
    if (/OTHERS|PACKAGING/i.test(r.section)) continue
    opening.set(r.month, (opening.get(r.month) ?? 0) + Number(r.opening_amount))
    bought.set(r.month, (bought.get(r.month) ?? 0) + Number(r.bought_amount))
  }
  const monthSales = new Map<string, number>()
  for (const s of sales) {
    const month = s.sale_date.slice(0, 7)
    monthSales.set(month, (monthSales.get(month) ?? 0) + Number(s.net_sales))
  }

  const rates = new Map<string, { rate: number; basis: FoodBasis }>()
  const open = (month: string) => opening.get(month) ?? 0
  const counted = [...opening.keys()].filter(m => open(m) > 0 && open(nextMonth(m)) > 0 && (monthSales.get(m) ?? 0) > 0)
  let used = 0
  let soldInCounted = 0
  for (const m of counted) {
    const food = open(m) + (bought.get(m) ?? 0) - open(nextMonth(m))
    rates.set(m, { rate: food / monthSales.get(m)!, basis: 'counted' })
    used += food
    soldInCounted += monthSales.get(m)!
  }
  const averageRate = soldInCounted ? used / soldInCounted : 0
  const averageClosing = counted.length ? counted.reduce((s, m) => s + open(nextMonth(m)), 0) / counted.length : 0

  const thisMonth = todayISO().slice(0, 7)
  return (month: string) => {
    const known = rates.get(month)
    if (known) return known
    const sold = monthSales.get(month) ?? 0
    if (month < thisMonth && open(month) > 0 && sold > 0) {
      return { rate: (open(month) + (bought.get(month) ?? 0) - averageClosing) / sold, basis: 'estimated_closing' as const }
    }
    return { rate: averageRate, basis: 'average' as const }
  }
}

// Every day from..to that has sales or purchases, plus the basis used for each month.
export async function dailyFoodCost(from: string, to: string) {
  const [rateFor, sales, buys] = await Promise.all([
    foodRates(),
    readAll<{ sale_date: string; net_sales: number }>((a, b) =>
      supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', from).lte('sale_date', to).order('sale_date').range(a, b)),
    readAll<{ purchase_date: string; amount: number }>((a, b) =>
      supabase.from('purchases').select('purchase_date, amount').gte('purchase_date', from).lte('purchase_date', to).order('id').range(a, b)),
  ])

  const byDate = new Map<string, FoodDay>()
  const day = (date: string) => {
    const known = byDate.get(date)
    if (known) return known
    const fresh = { date, sales: 0, food_cost: 0, purchases: 0 }
    byDate.set(date, fresh)
    return fresh
  }
  for (const s of sales) {
    const d = day(s.sale_date)
    d.sales = Number(s.net_sales)
    d.food_cost = d.sales * rateFor(s.sale_date.slice(0, 7)).rate
  }
  for (const b of buys) day(b.purchase_date).purchases += Number(b.amount)

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const months = [...new Set(days.map(d => d.date.slice(0, 7)))]
  return { days, months: months.map(month => ({ month, ...rateFor(month) })) }
}

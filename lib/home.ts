import 'server-only'
import { supabase } from './supabase'
import { inCogs } from './cogs-rule'
import { foodRates } from './daily-cogs'

// Figures for the homepage Overview: food cost by month (real where the stock count is
// done, estimated after), daily sales for a month, and the top suppliers.

export const FOOD_TARGET = 30 // % of nett sales (Eric, 25 Nov 2026)

export type MonthFood = { month: string; sales: number; cogs: number; pct: number | null; counted: boolean }

const ymAdd = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

async function readAll<T>(build: (a: number, b: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data } = await build(a, a + 999)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

// Jan of the year up to the month of `day`. A month with its stock count done uses
// opening + purchases − closing (food, ice, packaging, gas); later months use the
// Daily COGS estimate (nett sales × the month's food cost %).
export async function foodByMonth(day: string): Promise<MonthFood[]> {
  const year = day.slice(0, 4)
  const lastMonth = day.slice(0, 7)
  const [sales, stock, { data: closed }, rateFor] = await Promise.all([
    readAll<{ sale_date: string; net_sales: number }>((a, b) =>
      supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', `${year}-01-01`).lte('sale_date', day).order('sale_date').range(a, b)),
    readAll<{ month: string; section: string; item: string; opening_amount: number; bought_amount: number; closing_amount: number }>((a, b) =>
      supabase.from('stock_counts').select('month, section, item, opening_amount, bought_amount, closing_amount').gte('month', `${year}-01`).order('id').range(a, b)),
    supabase.from('stock_closed').select('month'),
    foodRates(),
  ])
  const done = new Set((closed ?? []).map(c => c.month as string))
  const out: MonthFood[] = []
  for (let m = `${year}-01`; m <= lastMonth; m = ymAdd(m, 1)) {
    const s = sales.filter(r => r.sale_date.startsWith(m)).reduce((t, r) => t + Number(r.net_sales), 0)
    let cogs = 0
    const counted = done.has(m)
    if (counted) {
      cogs = stock.filter(r => r.month === m && inCogs(r.section, r.item))
        .reduce((t, r) => t + Number(r.opening_amount) + Number(r.bought_amount) - Number(r.closing_amount), 0)
    } else {
      cogs = s * rateFor(m).rate
    }
    out.push({ month: m, sales: s, cogs, pct: s ? (cogs / s) * 100 : null, counted })
  }
  return out
}

export type DaySale = { date: string; nett: number }
export async function salesByDay(month: string, upTo: string, live?: { date: string; nett: number } | null): Promise<DaySale[]> {
  const { data } = await supabase.from('daily_sales').select('sale_date, net_sales')
    .gte('sale_date', `${month}-01`).lte('sale_date', upTo).order('sale_date')
  const rows = (data ?? []).map(r => ({ date: r.sale_date as string, nett: Number(r.net_sales) }))
  if (live && live.date.startsWith(month) && live.date <= upTo && !rows.some(r => r.date === live.date)) rows.push(live)
  return rows
}

export type SupplierSpend = { supplier: string; now: number; before: number }
// This month to the day vs last month to the same day.
export async function topSuppliers(day: string, limit = 6): Promise<SupplierSpend[]> {
  const month = day.slice(0, 7)
  const prev = ymAdd(month, -1)
  const sameDay = `${prev}-${day.slice(8, 10)}`
  const prevTo = sameDay > lastDay(prev) ? lastDay(prev) : sameDay
  const [{ data: now }, { data: before }] = await Promise.all([
    supabase.from('purchases').select('supplier, amount').gte('purchase_date', `${month}-01`).lte('purchase_date', day),
    supabase.from('purchases').select('supplier, amount').gte('purchase_date', `${prev}-01`).lte('purchase_date', prevTo),
  ])
  const sum = (rows: { supplier: string; amount: number }[] | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) {
      const k = String(r.supplier || 'Unknown').trim().toUpperCase()
      m.set(k, (m.get(k) ?? 0) + Number(r.amount || 0))
    }
    return m
  }
  const a = sum(now as any), b = sum(before as any)
  return [...a.entries()].map(([supplier, v]) => ({ supplier, now: v, before: b.get(supplier) ?? 0 }))
    .sort((x, y) => y.now - x.now).slice(0, limit)
}

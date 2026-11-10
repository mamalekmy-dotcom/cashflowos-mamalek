import 'server-only'
import { supabase } from './supabase'
import { flrFor, daysIn } from './flr'
import { inCogs } from './cogs-rule'
import { billedExpenses, categories } from './expenses'

// The Management Report: a month's profit and loss. Months the TMS report covers use its
// figures. Later months are built here: nett sales from the POS, COGS from Stock 2026
// (or approved ingredient bills before the count), salaries and rental from the FLR
// key-in, and every other expense from bills sent to the bot plus the monthly key-in.

export type Line = { key: string; label: string; amount: number; keyed?: number; billed?: number; categoryId?: number }
export type Bill = { id: number; day: string; title: string; amount: number; expense: string }

export async function mgmtFor(month: string, today: string) {
  const from = `${month}-01`
  const to = `${month}-${String(daysIn(month)).padStart(2, '0')}`
  const { data: tms } = await supabase.from('monthly_pnl')
    .select('net_sales, cogs, variable_costs, labor, rent, fixed_costs, profit_before_tax').eq('month', month).maybeSingle()

  if (tms) {
    const n = (v: unknown) => Number(v) || 0
    const lines: Line[] = [
      { key: 'salaries', label: 'Salaries', amount: n(tms.labor) },
      { key: 'rental', label: 'Rental', amount: n(tms.rent) },
      { key: 'other-variable', label: 'Other variable costs', amount: n(tms.variable_costs) - n(tms.cogs) },
      { key: 'other-fixed', label: 'Other fixed costs', amount: n(tms.fixed_costs) - n(tms.labor) - n(tms.rent) },
    ]
    const netSales = n(tms.net_sales)
    const cogs = n(tms.cogs)
    return {
      source: 'tms' as const, running: false, daysSoFar: daysIn(month), netSales, cogs,
      cogsFrom: 'from the TMS report', lines, bills: [] as Bill[],
      expenses: lines.reduce((s, l) => s + l.amount, 0),
      profit: n(tms.profit_before_tax), keyed: new Map<number, number>(),
    }
  }

  const [f, cats, bills, { data: keyedRows }, { data: stock }] = await Promise.all([
    flrFor(month, today),
    categories(),
    billedExpenses(from, to),
    supabase.from('monthly_expenses').select('category_id, amount').eq('month', month),
    supabase.from('stock_counts').select('section, item, bought_amount').eq('month', month),
  ])
  const share = f.daysSoFar / daysIn(month)
  const keyed = new Map((keyedRows ?? []).map(r => [Number(r.category_id), Number(r.amount) || 0]))

  // A bill's category, matched by name. Older bills carry the reader's own guess, which
  // counts only when it is one of the report's categories.
  const byName = new Map(cats.map(c => [c.name.toLowerCase(), c]))
  const billed = new Map<number, number>()
  let loose = 0
  for (const b of bills) {
    const c = byName.get(b.expense.toLowerCase())
    if (c) billed.set(c.id, (billed.get(c.id) ?? 0) + b.amount)
    else loose += b.amount
  }

  const lines: Line[] = [
    { key: 'salaries', label: 'Salaries', amount: f.labour },
    { key: 'rental', label: 'Rental', amount: f.rent },
    ...cats.map(c => {
      const k = (keyed.get(c.id) ?? 0) * share
      const b = billed.get(c.id) ?? 0
      return { key: `c${c.id}`, label: c.name, amount: k + b, keyed: k, billed: b, categoryId: c.id }
    }),
    {
      key: 'supplies', label: 'Kitchen supplies (Stock 2026 OTHERS)',
      amount: (stock ?? []).filter(r => !inCogs(r.section, r.item)).reduce((s, r) => s + Number(r.bought_amount), 0),
    },
    { key: 'loose', label: 'Bills without a category', amount: loose },
  ]
  const expenses = lines.reduce((s, l) => s + l.amount, 0)
  return {
    source: 'app' as const, running: f.running, daysSoFar: f.daysSoFar, netSales: f.netSales, cogs: f.food,
    cogsFrom: f.foodFrom, lines, bills: bills as Bill[], expenses,
    profit: f.netSales - f.food - expenses, keyed,
    fullLabour: f.fullLabour, fullRent: f.fullRent, costsFrom: f.costsFrom,
  }
}

export const MGMT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1BDY-rFBAPFcwB25nZhxqe88al0nKQ44mpS2AH0KJPfo/edit'
const FIRST_MONTH = '2026-01'

// Every month of the year so far, written to the Google Sheet. Run each morning.
export async function pushMgmtSheet(today: string) {
  const { writeMgmtSheet } = await import('./stock-sheet')
  const months: string[] = []
  for (let m = FIRST_MONTH; m <= today.slice(0, 7);) {
    months.push(m)
    const [y, mm] = m.split('-').map(Number)
    m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7)
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(1)}%` : '')
  const summary: (string | number)[][] = [['Month', 'Nett sales', 'COGS', 'Gross profit', 'Expenses', 'Net profit', 'Profit %', 'Source']]
  const tabs: { month: string; rows: (string | number)[][] }[] = []
  for (const month of months) {
    const r = await mgmtFor(month, today)
    const gross = r.netSales - r.cogs
    summary.push([month, r2(r.netSales), r2(r.cogs), r2(gross), r2(r.expenses), r2(r.profit), pct(r.profit, r.netSales),
      r.source === 'tms' ? 'TMS report' : r.running ? `App, ${r.daysSoFar} days so far` : 'App'])
    tabs.push({
      month,
      rows: [
        ['Line', 'RM', '% of nett sales'],
        ['Nett sales', r2(r.netSales), '100%'],
        ['COGS', r2(r.cogs), pct(r.cogs, r.netSales)],
        ['Gross profit', r2(gross), pct(gross, r.netSales)],
        ...r.lines.filter(l => Math.abs(l.amount) >= 0.005).map(l => [l.label, r2(l.amount), pct(l.amount, r.netSales)]),
        ['Total expenses', r2(r.expenses), pct(r.expenses, r.netSales)],
        [r.profit >= 0 ? 'Net profit' : 'Net loss', r2(r.profit), pct(r.profit, r.netSales)],
        ...(r.bills.length ? [['', '', ''], ['Bills', '', 'Category'],
          ...r.bills.sort((a, b) => a.day.localeCompare(b.day)).map(b => [`${b.day} ${b.title}`, r2(b.amount), b.expense || ''])] : []),
      ],
    })
  }
  return writeMgmtSheet({ summary, months: tabs })
}

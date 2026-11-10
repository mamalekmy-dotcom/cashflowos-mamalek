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

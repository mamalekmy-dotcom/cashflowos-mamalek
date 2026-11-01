import Link from 'next/link'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { dailyFoodCost, FOOD_BASIS_LABEL } from '@/lib/daily-cogs'
import Stat from '@/app/_components/Stat'
import { AddCost, DayCell, UploadSales } from './PulseActions'

export const dynamic = 'force-dynamic'

const pad = (n: number) => String(n).padStart(2, '0')
const percent = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—')

type MonthlyPnl = {
  net_sales: number
  cogs: number
  variable_costs: number
  labor: number
  rent: number
  fixed_costs: number
  profit_before_tax: number
  pax: number
}

// Sales, and what's left once they split into food, labour, rent and other. Prime cost
// (food + labour) is the number restaurants watch. A month with a TMS report uses those
// figures as they are. Otherwise sales come from daily_sales and costs from cost_entries,
// so a cost that hasn't been entered makes the month look better than it is. The page
// says so rather than letting it pass as real profit.
export default async function Pulse({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams
  const today = todayISO()
  const month = /^\d{4}-\d{2}$/.test(asked ?? '') ? (asked as string) : today.slice(0, 7)
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const from = `${month}-01`
  const to = `${month}-${pad(daysInMonth)}`
  const shift = (by: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + by, 1))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
  }

  const [{ data: sales }, { data: costs }, { data: tmsRow }, foodCost] = await Promise.all([
    supabase.from('daily_sales').select('sale_date, net_sales, receipts, pax').gte('sale_date', from).lte('sale_date', to),
    supabase.from('cost_entries').select('category, amount').gte('entry_date', from).lte('entry_date', to),
    supabase.from('monthly_pnl').select('net_sales, cogs, variable_costs, labor, rent, fixed_costs, profit_before_tax, pax').eq('month', month).maybeSingle(),
    dailyFoodCost(from, to).catch(e => {
      console.error('[CFO] daily food cost failed:', e)
      return { days: [], months: [] }
    }),
  ])
  const foodBasis = foodCost.months[0]
  const foodTotal = foodCost.days.reduce((sum, d) => sum + d.food_cost, 0)
  const boughtTotal = foodCost.days.reduce((sum, d) => sum + d.purchases, 0)

  const tms = tmsRow ? (Object.fromEntries(Object.entries(tmsRow).map(([k, v]) => [k, Number(v)])) as MonthlyPnl) : null
  const byDay = new Map((sales ?? []).map(s => [s.sale_date as string, Number(s.net_sales)]))
  const dailyTotal = [...byDay.values()].reduce((sum, n) => sum + n, 0)
  const spent = (category: string) =>
    (costs ?? []).filter(c => c.category === category).reduce((sum, c) => sum + Number(c.amount), 0)
  const total = tms ? tms.net_sales : dailyTotal
  const food = tms ? tms.cogs : spent('food')
  const labor = tms ? tms.labor : spent('labor')
  const rent = tms ? tms.rent : spent('rent')
  const other = tms ? tms.variable_costs - tms.cogs + tms.fixed_costs - tms.labor - tms.rent : spent('other')
  const allCosts = food + labor + rent + other
  const kept = total - allCosts
  const receipts = (sales ?? []).reduce((sum, s) => sum + Number(s.receipts), 0)
  const pax = tms?.pax || (sales ?? []).reduce((sum, s) => sum + Number(s.pax), 0)
  const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()
  const monthName = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <>
      <h1 className="ph">P&amp;L Pulse</h1>
      <p className="cap">Tap a day to log sales, or upload your Colmo report.</p>

      <div className="grid">
        <Stat label="Net sales" value={rm(total)} />
        <Stat label="Prime cost" value={percent(food + labor, total)} />
        <Stat label="Kept" value={rm(kept)} />
        <Stat label="Avg per pax" value={pax ? rm(Math.round(total / pax)) : '—'} />
      </div>

      {tms ? <p className="cap">{monthName} figures are from TMS. Kept is profit before tax.</p> : null}
      {tms && labor === 0 ? (
        <p className="login-error" style={{ marginBottom: 16 }}>
          TMS has no labour or rent for {monthName}, so Kept is too high.
        </p>
      ) : null}
      {!tms && total > 0 && allCosts === 0 ? (
        <p className="login-error" style={{ marginBottom: 16 }}>
          No costs entered for {monthName} yet, so Kept is just sales, not profit.
        </p>
      ) : null}

      <div className="pulse-head">
        <Link className="btn ghost" href={`/pulse?month=${shift(-1)}`} aria-label="Previous month">‹</Link>
        <strong>{monthName}</strong>
        <Link className="btn ghost" href={`/pulse?month=${shift(1)}`} aria-label="Next month">›</Link>
      </div>
      <div className="pulse-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span className="pulse-dow" key={i}>{d}</span>)}
        {Array.from({ length: firstWeekday }, (_, i) => <span key={`blank-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${month}-${pad(i + 1)}`
          return <DayCell key={date} date={date} day={i + 1} sales={byDay.get(date) ?? null} />
        })}
      </div>

      <p className="rowlabel" style={{ marginTop: 24 }}>Where the sales went</p>
      <table className="tbl" style={{ marginBottom: 24 }}>
        <thead><tr><th>Item</th><th>Amount</th><th>% of sales</th></tr></thead>
        <tbody>
          {[['Food', food], ['Labour', labor], ['Rent', rent], ['Other', other], ['Kept', kept]].map(([name, value]) => (
            <tr key={name as string}>
              <td data-label="Item">{name}</td>
              <td data-label="Amount">{rm(value as number)}</td>
              <td data-label="% of sales">{percent(value as number, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cap figure">{receipts.toLocaleString('en-MY')} receipts · {pax.toLocaleString('en-MY')} pax · {byDay.size} trading days</p>

      {foodBasis ? (
        <>
          <p className="rowlabel" style={{ marginTop: 24 }}>Daily food cost</p>
          <p className="cap">
            Estimated: each day&apos;s sales before tax × {(foodBasis.rate * 100).toFixed(1)}% ({FOOD_BASIS_LABEL[foodBasis.basis]}).
            Stock is counted monthly, so the % is the same every day. Purchases are actual.
          </p>
          <p className="cap figure">Estimated food cost {rm(Math.round(foodTotal))} · Purchases {rm(Math.round(boughtTotal))}</p>
          <details style={{ marginBottom: 24 }}>
            <summary>Show every day</summary>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Sales</th><th>Est. food cost</th><th>Purchases</th></tr></thead>
              <tbody>
                {foodCost.days.map(d => (
                  <tr key={d.date}>
                    <td data-label="Date">{d.date}</td>
                    <td data-label="Sales">{rm(d.sales)}</td>
                    <td data-label="Est. food cost">{rm(Math.round(d.food_cost))}</td>
                    <td data-label="Purchases">{rm(Math.round(d.purchases))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : null}

      <UploadSales />
      <AddCost defaultDate={today} />
    </>
  )
}

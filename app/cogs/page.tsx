import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { ClosedButton, RefreshButton } from './Buttons'
import CogsChart, { type ChartMonth } from './CogsChart'

export const dynamic = 'force-dynamic'

const PAGE = 1000
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Food ingredients and takeaway packaging count. The sheet's OTHERS sections (gas, spoons) don't.
const counts = (section: string) => !/OTHERS/i.test(section)

type Count = { month: string; section: string; opening_amount: number; bought_amount: number; closing_amount: number }

// A year of stock rows runs past Supabase's 1,000-row reply, so read it a page at a time.
async function stockRows(year: string): Promise<Count[]> {
  const rows: Count[] = []
  for (let page = 0; ; page++) {
    const { data } = await supabase.from('stock_counts').select('month, section, opening_amount, bought_amount, closing_amount')
      .gte('month', `${year}-01`).lte('month', `${year}-12`).order('id').range(page * PAGE, page * PAGE + PAGE - 1)
    rows.push(...((data ?? []) as Count[]))
    if ((data ?? []).length < PAGE) return rows
  }
}

// COGS = opening stock + purchases − closing stock, from Stock 2026, for each month of
// the year. A month's COGS shows once its closing count is marked done, so a half-done
// count can't show a wrong figure.
export default async function CogsReport({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: asked } = await searchParams
  const thisYear = todayISO().slice(0, 4)
  const year = /^\d{4}$/.test(asked ?? '') && (asked as string) <= thisYear ? (asked as string) : thisYear
  const thisMonth = todayISO().slice(0, 7)

  const [stock, { data: sales }, { data: tms }, { data: closed }] = await Promise.all([
    stockRows(year),
    supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', `${year}-01-01`).lte('sale_date', `${year}-12-31`),
    supabase.from('monthly_pnl').select('month, net_sales').gte('month', `${year}-01`).lte('month', `${year}-12`),
    supabase.from('stock_closed').select('month').gte('month', `${year}-01`).lte('month', `${year}-12`),
  ])
  const done = new Set((closed ?? []).map(c => c.month as string))

  const months = SHORT.map((label, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`
    const rows = stock.filter(r => r.month === month && counts(r.section))
    const add = (k: keyof Omit<Count, 'month' | 'section'>) => rows.reduce((s, r) => s + Number(r[k]), 0)
    const opening = add('opening_amount'), purchases = add('bought_amount'), closing = add('closing_amount')
    const pos = (sales ?? []).filter(s => s.sale_date.startsWith(month)).reduce((s, r) => s + Number(r.net_sales), 0)
    const netSales = pos || Number(tms?.find(t => t.month === month)?.net_sales ?? 0)
    const isClosed = done.has(month)
    const cogs = isClosed ? opening + purchases - closing : null
    return { month, label, hasStock: rows.length > 0, opening, purchases, closing, isClosed, cogs, netSales, percent: cogs != null && netSales ? (cogs / netSales) * 100 : null }
  })

  const shown = months.filter(m => m.hasStock || m.netSales)
  const chart: ChartMonth[] = months.map(m => ({ month: m.month, label: m.label, sales: m.netSales, cogs: m.cogs, percent: m.percent }))
  const final = months.filter(m => m.cogs != null)
  const yearCogs = final.reduce((s, m) => s + (m.cogs ?? 0), 0)
  const yearSales = final.reduce((s, m) => s + m.netSales, 0)
  const latest = final.at(-1)

  return (
    <>
      <h1 className="ph">COGS Report</h1>
      <p className="cap">COGS = Opening stock + Purchases − Closing stock, from Stock 2026. Food ingredients and takeaway packaging; OTHERS (gas, spoons) left out. Updated from the sheet every morning.</p>

      <div className="pulse-head">
        <Link className="btn ghost" href={`/cogs?year=${Number(year) - 1}`} aria-label="Previous year">‹</Link>
        <strong>{year}</strong>
        {year < thisYear ? <Link className="btn ghost" href={`/cogs?year=${Number(year) + 1}`} aria-label="Next year">›</Link> : <span />}
      </div>

      <div className="grid">
        <Stat label={latest ? `COGS, ${latest.label} ${year}` : 'COGS, last counted month'} value={latest?.percent != null ? `${latest.percent.toFixed(1)}%` : '–'} sub={latest ? rm(latest.cogs ?? 0) : undefined} />
        <Stat label={`COGS, ${year} so far`} value={yearSales ? `${((yearCogs / yearSales) * 100).toFixed(1)}%` : '–'} sub={rm(yearCogs)} />
        <Stat label="Nett sales, counted months" value={rm(yearSales)} sub={`${final.length} month${final.length === 1 ? '' : 's'}`} />
      </div>

      <div className="admin-card" style={{ marginBottom: 20 }}>
        <p className="rowlabel">Nett sales vs COGS, {year}</p>
        <CogsChart months={chart} />
      </div>

      <RefreshButton />

      <table className="tbl">
        <thead><tr><th>Month</th><th>Opening</th><th>Purchases</th><th>Closing</th><th>COGS</th><th>Nett sales</th><th>COGS %</th><th>Closing count</th></tr></thead>
        <tbody>
          {shown.map(m => (
            <tr key={m.month}>
              <td data-label="Month">{m.label} {year}</td>
              <td data-label="Opening">{m.hasStock ? rm(m.opening) : '–'}</td>
              <td data-label="Purchases">{m.hasStock ? rm(m.purchases) : '–'}</td>
              <td data-label="Closing">{m.hasStock ? rm(m.closing) : '–'}</td>
              <td data-label="COGS">{m.cogs != null ? rm(m.cogs) : m.month >= thisMonth ? 'Month still running' : 'Waiting for closing count'}</td>
              <td data-label="Nett sales">{m.netSales ? rm(m.netSales) : '–'}</td>
              <td data-label="COGS %">{m.percent != null ? `${m.percent.toFixed(1)}%` : '–'}</td>
              <td data-label="Closing count">{m.hasStock && m.month < thisMonth ? <ClosedButton month={m.month} closed={m.isClosed} /> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cap" style={{ marginTop: 12 }}>Once the month-end stock count is entered in Stock 2026, press <b>Closing count done</b> for that month and its COGS shows here.</p>
    </>
  )
}

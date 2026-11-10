import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import { categories } from '@/lib/expenses'
import { daysIn } from '@/lib/flr'
import { mgmtFor } from '@/lib/mgmt'
import { rm, todayISO } from '@/lib/records'
import KeyInForm from './KeyInForm'

export const dynamic = 'force-dynamic'

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shown = (iso: string) => iso.split('-').reverse().join('/')

export default async function ManagementReport({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams
  const today = todayISO()
  const thisMonth = today.slice(0, 7)
  const month = /^\d{4}-\d{2}$/.test(asked ?? '') && (asked as string) <= thisMonth ? (asked as string) : thisMonth
  const [r, cats] = await Promise.all([mgmtFor(month, today), categories()])

  const money = (n: number) => (n < 0 ? `-${rm(-n)}` : rm(n))
  const pct = (n: number) => (r.netSales ? `${((n / r.netSales) * 100).toFixed(1)}%` : '–')
  const gross = r.netSales - r.cogs
  const shownLines = r.lines.filter(l => Math.abs(l.amount) >= 0.005 || l.key === 'salaries' || l.key === 'rental')

  return (
    <>
      <h1 className="ph">Management Report</h1>
      <p className="cap">Profit and loss for the month: nett sales, COGS and every expense.</p>

      <div className="pulse-head">
        <Link className="btn ghost" href={`/mgmt?month=${shiftMonth(month, -1)}`} aria-label="Previous month">‹</Link>
        <strong>{monthLabel(month)}{r.running ? ' so far' : ''}</strong>
        {month < thisMonth
          ? <Link className="btn ghost" href={`/mgmt?month=${shiftMonth(month, 1)}`} aria-label="Next month">›</Link>
          : <span />}
      </div>

      <div className={`flr-strip ${r.profit >= 0 ? 'healthy' : 'unhealthy'}`}>
        <strong>{r.profit >= 0 ? 'Profit' : 'Loss'} {money(r.profit)}</strong>
        <span>{pct(r.profit)} of nett sales</span>
      </div>

      <div className="grid">
        <Stat label="Nett sales" value={rm(r.netSales)} />
        <Stat label="COGS" value={pct(r.cogs)} sub={rm(r.cogs)} />
        <Stat label="Gross profit" value={pct(gross)} sub={money(gross)} />
        <Stat label="Expenses" value={pct(r.expenses)} sub={rm(r.expenses)} />
      </div>

      <table className="tbl" style={{ maxWidth: 640, marginTop: 16 }}>
        <thead><tr><th>Line</th><th>RM</th><th>% of nett sales</th></tr></thead>
        <tbody>
          <tr><td data-label="Line"><strong>Nett sales</strong></td><td data-label="RM"><strong>{rm(r.netSales)}</strong></td><td data-label="% of nett sales">100%</td></tr>
          <tr><td data-label="Line">COGS</td><td data-label="RM">{rm(r.cogs)}</td><td data-label="% of nett sales">{pct(r.cogs)}</td></tr>
          <tr><td data-label="Line"><strong>Gross profit</strong></td><td data-label="RM"><strong>{money(gross)}</strong></td><td data-label="% of nett sales">{pct(gross)}</td></tr>
          {shownLines.map(l => (
            <tr key={l.key}>
              <td data-label="Line">
                {l.label}
                {l.keyed && l.billed ? <span className="cap"> · keyed {rm(l.keyed)} + bills {rm(l.billed)}</span> : null}
              </td>
              <td data-label="RM">{money(l.amount)}</td>
              <td data-label="% of nett sales">{pct(l.amount)}</td>
            </tr>
          ))}
          <tr><td data-label="Line"><strong>Total expenses</strong></td><td data-label="RM"><strong>{rm(r.expenses)}</strong></td><td data-label="% of nett sales">{pct(r.expenses)}</td></tr>
          <tr><td data-label="Line"><strong>{r.profit >= 0 ? 'Net profit' : 'Net loss'}</strong></td><td data-label="RM"><strong>{money(r.profit)}</strong></td><td data-label="% of nett sales">{pct(r.profit)}</td></tr>
        </tbody>
      </table>

      {r.source === 'tms' ? (
        <p className="cap">This month uses the TMS report&apos;s figures. Expenses are by category from November 2026.</p>
      ) : (
        <>
          <p className="cap">COGS: {r.cogsFrom}. Food, ice, packaging and gas count.</p>
          <p className="cap">
            Salaries {rm(r.fullLabour)} and rental {rm(r.fullRent)} for the month, {r.costsFrom}.
            {r.running ? ` Salaries, rental and keyed-in costs count for ${r.daysSoFar} of ${daysIn(month)} days so far, to match the sales.` : ''}
          </p>

          {r.bills.length ? (
            <>
              <p className="rowlabel" style={{ marginTop: 20 }}>Bills this month</p>
              <table className="tbl" style={{ maxWidth: 640 }}>
                <thead><tr><th>Date</th><th>Bill</th><th>Category</th><th>RM</th></tr></thead>
                <tbody>
                  {r.bills.sort((a, b) => a.day.localeCompare(b.day)).map(b => (
                    <tr key={b.id}>
                      <td data-label="Date">{shown(b.day)}</td>
                      <td data-label="Bill">{b.title}</td>
                      <td data-label="Category">{b.expense || '–'}</td>
                      <td data-label="RM">{money(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <KeyInForm key={month} month={month} label={monthLabel(month)}
            rows={cats.map(c => ({ id: c.id, name: c.name, amount: r.keyed.get(c.id) ?? 0 }))} />
        </>
      )}
    </>
  )
}

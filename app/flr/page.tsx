import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import { daysIn, flrFor, flrHealth } from '@/lib/flr'
import { rm, todayISO } from '@/lib/records'
import CostsForm from './CostsForm'
import Doughnut, { type Slice } from './Doughnut'
import HealthStrip from './HealthStrip'

export const dynamic = 'force-dynamic'

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export default async function FlrReport({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams
  const today = todayISO()
  const thisMonth = today.slice(0, 7)
  const month = /^\d{4}-\d{2}$/.test(asked ?? '') && (asked as string) <= thisMonth ? (asked as string) : thisMonth
  const f = await flrFor(month, today)

  const pct = (n: number) => (f.netSales ? `${((n / f.netSales) * 100).toFixed(1)}%` : '–')
  const money = (n: number) => (n < 0 ? `-${rm(-n)}` : rm(n))
  const balance = f.netSales - f.flr
  const slices: Slice[] = [
    { key: 'food', label: 'Food', amount: f.food, color: 'var(--clay)' },
    { key: 'labour', label: 'Labour', amount: f.labour, color: 'var(--f-views)' },
    { key: 'rent', label: 'Rental', amount: f.rent, color: 'var(--honey)' },
    { key: 'balance', label: 'Balance', amount: balance, color: 'var(--sage)' },
  ]
    .map(s => ({ ...s, percent: pct(s.amount), money: money(s.amount), amount: Math.max(s.amount, 0) }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <>
      <h1 className="ph">FLR Report</h1>
      <p className="cap">Food, labour and rental as a share of nett sales.</p>

      <div className="pulse-head">
        <Link className="btn ghost" href={`/flr?month=${shiftMonth(month, -1)}`} aria-label="Previous month">‹</Link>
        <strong>{monthLabel(month)}{f.running ? ' so far' : ''}</strong>
        {month < thisMonth
          ? <Link className="btn ghost" href={`/flr?month=${shiftMonth(month, 1)}`} aria-label="Next month">›</Link>
          : <span />}
      </div>

      <div className="admin-card" style={{ maxWidth: 640 }}>
        <Doughnut slices={slices} flr={pct(f.flr)} sales={rm(f.netSales)} warn={f.flrPercent !== null && flrHealth(f.flrPercent) === 'unhealthy'} />
        <HealthStrip percent={f.flrPercent} />
        <table className="tbl">
          <thead><tr><th>Part</th><th>RM</th><th>% of nett sales</th></tr></thead>
          <tbody>
            {slices.map(s => (
              <tr key={s.key}>
                <td data-label="Part"><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />{s.label}</td>
                <td data-label="RM">{s.money}</td>
                <td data-label="% of nett sales">{s.percent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <Stat label="Nett sales" value={rm(f.netSales)} />
        <Stat label="Prime cost (F + L)" value={pct(f.food + f.labour)} sub={rm(f.food + f.labour)} />
        <Stat label="FLR (F + L + R)" value={pct(f.flr)} sub={rm(f.flr)} />
        <Stat label="Balance after FLR" value={pct(balance)} sub={money(balance)} />
      </div>

      <p className="cap">Food: {f.foodFrom}. Gas counts; the rest of the sheet&apos;s OTHERS section (detergent, gloves) goes to the Management Report.</p>
      <p className="cap">
        Labour {rm(f.fullLabour)} and rental {rm(f.fullRent)} for the month, {f.costsFrom}.
        {f.running ? ` Counted for ${f.daysSoFar} of ${daysIn(month)} days so far, to match the sales.` : ''}
      </p>

      <CostsForm key={month} month={month} label={monthLabel(month)} labour={f.keyedLabour ?? f.fullLabour} rent={f.keyedRent ?? f.fullRent} />
    </>
  )
}

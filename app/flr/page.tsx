import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import { rm, todayISO } from '@/lib/records'
import { NOT_STOCK } from '@/lib/stock-logic'
import { supabase } from '@/lib/supabase'
import CostsForm from './CostsForm'

export const dynamic = 'force-dynamic'

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const isFood = (section: string) => !/OTHERS|PACKAGING/i.test(section)

type Slice = { key: string; label: string; amount: number; color: string }

// Food, labour and rental against nett sales for one month.
// Food: ingredient lines on bills approved on Telegram (items sorted into Others are
// left out). A month from before the bot uses the food purchases in Stock 2026.
// Labour and rental: keyed in on this page; a month not keyed in uses the TMS report.
async function flrFor(month: string, today: string) {
  const from = `${month}-01`
  const to = `${month}-${String(daysIn(month)).padStart(2, '0')}`
  const [{ data: sales }, { data: bills }, { data: stock }, { data: keyed }, { data: tms }, { data: items }] = await Promise.all([
    supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', from).lte('sale_date', to),
    supabase.from('agent_actions').select('payload').eq('agent_key', 'stock-receipt').eq('status', 'executed')
      .gte('payload->>date', from).lte('payload->>date', to),
    supabase.from('stock_counts').select('section, bought_amount').eq('month', month),
    supabase.from('monthly_costs').select('labour, rent').eq('month', month).maybeSingle(),
    supabase.from('monthly_pnl').select('net_sales, labor, rent').eq('month', month).maybeSingle(),
    supabase.from('stock_items').select('name, section'),
  ])

  const days = sales ?? []
  const posSales = days.reduce((s, r) => s + Number(r.net_sales), 0)
  const netSales = posSales || Number(tms?.net_sales ?? 0)

  // Stock items in the OTHERS or packaging sections (gas, spoons) aren't food either.
  const notFood = new Set((items ?? []).filter(i => !isFood(i.section)).map(i => i.name as string))
  const foodLines = (bills ?? []).map(b => ((b.payload?.lines ?? []) as { item?: string; amount?: number }[])
    .filter(l => l.item && l.item !== NOT_STOCK && !notFood.has(l.item)))
  const foodBills = foodLines.filter(lines => lines.length).length
  const billFood = foodLines.flat().reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const sheetFood = (stock ?? []).filter(r => isFood(r.section)).reduce((s, r) => s + Number(r.bought_amount), 0)
  const food = foodBills ? billFood : sheetFood
  const foodFrom = foodBills
    ? `${foodBills} bill${foodBills === 1 ? '' : 's'} approved on Telegram`
    : sheetFood ? 'food purchases in Stock 2026' : 'no ingredient bills yet'

  const fullLabour = keyed ? Number(keyed.labour) : Number(tms?.labor ?? 0)
  const fullRent = keyed ? Number(keyed.rent) : Number(tms?.rent ?? 0)
  const costsFrom = keyed ? 'keyed in' : tms ? 'from the TMS report' : 'not keyed in yet'

  // This month is still running, so labour and rental count only for the days with sales
  // so far. Otherwise a full month's wages sit against two days of sales.
  const running = month === today.slice(0, 7)
  const lastDay = days.reduce((d, r) => (r.sale_date > d ? r.sale_date : d), '')
  const daysSoFar = running ? (lastDay ? Number(lastDay.slice(8, 10)) : 0) : daysIn(month)
  const share = daysSoFar / daysIn(month)

  return {
    netSales, food, foodFrom, costsFrom, running, daysSoFar,
    keyedLabour: keyed ? Number(keyed.labour) : null, keyedRent: keyed ? Number(keyed.rent) : null,
    fullLabour, fullRent, labour: fullLabour * share, rent: fullRent * share,
  }
}

// Each slice's size is its share of nett sales, so the biggest cost has the biggest
// slice. What's left of sales is the Balance slice.
function Doughnut({ slices, centre, under, warn }: { slices: Slice[]; centre: string; under: string; warn: boolean }) {
  const r = 80
  const around = 2 * Math.PI * r
  const total = slices.reduce((s, x) => s + x.amount, 0)
  let start = 0
  return (
    <svg viewBox="0 0 220 220" width="100%" style={{ maxWidth: 280, display: 'block', margin: '0 auto' }} role="img" aria-label={`FLR ${centre}`}>
      <circle cx="110" cy="110" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="28" />
      {total > 0 && slices.map(s => {
        const len = (s.amount / total) * around
        const arc = (
          <circle key={s.key} cx="110" cy="110" r={r} fill="none" stroke={s.color} strokeWidth="28"
            strokeDasharray={`${len} ${around - len}`} strokeDashoffset={-start} transform="rotate(-90 110 110)" />
        )
        start += len
        return arc
      })}
      <text x="110" y="96" textAnchor="middle" fontSize="11" fill="var(--ink-soft)" letterSpacing="1">FLR</text>
      <text x="110" y="124" textAnchor="middle" fontSize="30" fontWeight="700" fill={warn ? 'var(--rust)' : 'var(--ink)'}>{centre}</text>
      <text x="110" y="144" textAnchor="middle" fontSize="11" fill="var(--ink-soft)">{under}</text>
    </svg>
  )
}

export default async function FlrReport({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams
  const today = todayISO()
  const thisMonth = today.slice(0, 7)
  const month = /^\d{4}-\d{2}$/.test(asked ?? '') && (asked as string) <= thisMonth ? (asked as string) : thisMonth
  const f = await flrFor(month, today)

  const pct = (n: number) => (f.netSales ? `${((n / f.netSales) * 100).toFixed(1)}%` : '–')
  const flr = f.food + f.labour + f.rent
  const balance = f.netSales - flr
  const slices: Slice[] = [
    { key: 'food', label: 'Food', amount: f.food, color: 'var(--clay)' },
    { key: 'labour', label: 'Labour', amount: f.labour, color: 'var(--f-views)' },
    { key: 'rent', label: 'Rental', amount: f.rent, color: 'var(--honey)' },
    { key: 'balance', label: 'Balance', amount: Math.max(balance, 0), color: 'var(--sage)' },
  ]
  const sorted = [...slices].sort((a, b) => b.amount - a.amount)

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
        <Doughnut slices={sorted} centre={pct(flr)} under={`of ${rm(f.netSales)} nett sales`} warn={balance < 0} />
        <table className="tbl" style={{ marginTop: 16 }}>
          <thead><tr><th>Part</th><th>RM</th><th>% of nett sales</th></tr></thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.key}>
                <td data-label="Part"><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />{s.label}</td>
                <td data-label="RM">{s.key === 'balance' && balance < 0 ? `-${rm(-balance)}` : rm(s.amount)}</td>
                <td data-label="% of nett sales">{s.key === 'balance' ? pct(balance) : pct(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <Stat label="Nett sales" value={rm(f.netSales)} />
        <Stat label="Prime cost (F + L)" value={pct(f.food + f.labour)} sub={rm(f.food + f.labour)} />
        <Stat label="FLR (F + L + R)" value={pct(flr)} sub={rm(flr)} yes={balance < 0} />
        <Stat label="Balance after FLR" value={pct(balance)} sub={balance < 0 ? `-${rm(-balance)}` : rm(balance)} />
      </div>

      <p className="cap">Food: {f.foodFrom}, ingredients only. Items sorted into Others, gas and packaging are left out.</p>
      <p className="cap">
        Labour {rm(f.fullLabour)} and rental {rm(f.fullRent)} for the month, {f.costsFrom}.
        {f.running ? ` Counted for ${f.daysSoFar} of ${daysIn(month)} days so far, to match the sales.` : ''}
      </p>

      <CostsForm key={month} month={month} label={monthLabel(month)} labour={f.keyedLabour ?? f.fullLabour} rent={f.keyedRent ?? f.fullRent} />
    </>
  )
}

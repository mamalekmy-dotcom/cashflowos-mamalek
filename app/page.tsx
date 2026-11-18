import { getRecords, isCashReceived, rm, todayISO } from '@/lib/records'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import Stat from '@/app/_components/Stat'
import { DAILY_TILES, SALES_COLUMNS, changeText, type SalesValues } from '@/app/report/fields'
import HealthStrip from '@/app/flr/HealthStrip'
import { costsUpTo, salesOverview, type Takings } from '@/lib/dashboard'
import DayPicker from './DayPicker'

export const dynamic = 'force-dynamic'

// Count of proposals still waiting on a human YES. Guarded so an
// unconfigured/placeholder Supabase returns 0 instantly instead of hanging.
async function proposedCount(): Promise<number> {
  if (!supabaseConfigured) return 0
  const { count, error } = await supabase
    .from('agent_actions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'proposed')
    .neq('agent_key', 'stock-draft')
  if (error) return 0
  return count ?? 0
}

// Leave waiting on a decision. Returns 0 if the HR tables aren't there.
async function leaveWaiting(): Promise<number> {
  if (!supabaseConfigured) return 0
  const { count, error } = await supabase
    .from('hr_leave_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) return 0
  return count ?? 0
}

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthOf = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthShort = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

// A picked day from the URL, else today. Never after today or before 2026.
const pickDay = (asked: string | undefined, today: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(asked ?? '') && asked! <= today && asked! >= '2026-01-01' ? asked! : today

// The latest report with figures in it, and the report from the calendar day before.
async function latestReports() {
  if (!supabaseConfigured) return null
  const { data } = await supabase.from('daily_reports').select(`report_date, ${SALES_COLUMNS}`)
    .or('sales_total.gt.0,cash.gt.0,qr.gt.0,card.gt.0')
    .order('report_date', { ascending: false }).limit(1)
  const latest = data?.[0] as unknown as (SalesValues & { report_date: string }) | undefined
  if (!latest) return null
  const previousDay = dayBefore(latest.report_date)
  const { data: earlier } = await supabase.from('daily_reports').select(SALES_COLUMNS).eq('report_date', previousDay).maybeSingle()
  return { day: latest.report_date, latest, previousDay, previous: earlier as unknown as SalesValues | null }
}

function SalesTable({ day, month, year, monthDays, monthLabel }: { day: Takings | null; month: Takings; year: Takings; monthDays: number; monthLabel: string }) {
  const cols = [`${monthLabel} so far (${monthDays} day${monthDays === 1 ? '' : 's'})`, 'Year so far']
  const cell = (t: Takings | null, f: (t: Takings) => number) => (t ? rm(Math.round(f(t) * 100) / 100) : "–")
  const lines: [string, (t: Takings) => number, boolean][] = [
    ['Nett sales', t => t.nett, true],
    ['Service charge 10%', t => t.service, false],
    ['SST 6%', t => t.sst, false],
    ['Total sales', t => t.nett + t.service + t.sst, true],
  ]
  return (
    <table className="tbl sales3" style={{ maxWidth: 820 }}>
      <thead><tr><th></th><th>Day</th><th>{cols[0]}</th><th>{cols[1]}</th></tr></thead>
      <tbody>
        {lines.map(([label, f, bold]) => {
          const B = ({ children }: { children: React.ReactNode }) => (bold ? <strong>{children}</strong> : <>{children}</>)
          return (
            <tr key={label}>
              <td data-label=""><B>{label}</B></td>
              <td data-label="Day"><B>{cell(day, f)}</B></td>
              <td data-label={cols[0]}><B>{cell(month, f)}</B></td>
              <td data-label={cols[1]}><B>{cell(year, f)}</B></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const dayName = (day: string, today: string, yesterday: string) =>
  day === today ? `Today, ${shortDate(day)}` : day === yesterday ? `Yesterday, ${shortDate(day)}` : shortDate(day)

type Search = { sales?: string; flr?: string; costs?: string }

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const asked = await searchParams
  const today = todayISO()
  const yesterday = dayBefore(today)
  const salesDay = pickDay(asked.sales, today)
  const flrDay = pickDay(asked.flr, today)
  const costsDay = pickDay(asked.costs, today)
  const [rows, waiting, leave, reports, sales, flr, costs] = await Promise.all([
    getRecords(), proposedCount(), leaveWaiting(), latestReports(),
    supabaseConfigured ? salesOverview(salesDay, today) : null,
    supabaseConfigured ? costsUpTo(flrDay, today) : null,
    supabaseConfigured ? costsUpTo(costsDay, today) : null,
  ])
  const share = (amount: number) => (costs?.netSales ? `${((amount / costs.netSales) * 100).toFixed(1)}%` : '–')
  const upTo = (day: string, dayNo: number) => (dayNo === 1 ? shortDate(day) : `1–${shortDate(day)}`)

  const cashIn = rows.filter(isCashReceived).reduce((s, r) => s + Number(r.amount || 0), 0)

  return (
    <>
      <h1 className="ph">Dashboard</h1>
      <p className="cap">Sales, costs and what&apos;s waiting on you.</p>

      {/* Sales Overview: the picked day, its month so far and its year so far */}
      {sales ? (
        <>
          <div className="sechead">
            <p className="rowlabel">Sales Overview · {dayName(salesDay, today, yesterday)}{sales.live ? ' · live from POS' : ''}</p>
            <DayPicker param="sales" day={salesDay} today={today} yesterday={yesterday} />
          </div>
          <SalesTable day={sales.dayTakings} month={sales.monthTakings} year={sales.yearTakings}
            monthDays={sales.monthDays} monthLabel={monthOf(salesDay).split(' ')[0]} />
          {sales.live && sales.liveError ? <p className="cap">Could not reach the POS ({sales.liveError}), so this day shows no sales yet.</p> : null}
          {sales.live && salesDay === today && !sales.liveError ? <p className="cap">Today is still trading, so today&apos;s figures keep growing. Reload for the latest.</p> : null}
          {sales.tmsMonths.length ? (
            <p className="cap">
              Year so far: {sales.tmsMonths.map(monthShort).join(', ')} {sales.tmsMonths.length === 1 ? 'is' : 'are'} nett sales from the TMS report,
              with no service charge or SST split, so those two only count months with POS data.
            </p>
          ) : null}
        </>
      ) : null}

      {/* FLR from the 1st of the month up to the picked day: green under 70%, red over */}
      {flr ? (
        <>
          <div className="sechead">
            <p className="rowlabel">FLR · {monthOf(flrDay)}, {upTo(flrDay, flr.dayNo)}</p>
            <DayPicker param="flr" day={flrDay} today={today} yesterday={yesterday} />
          </div>
          <HealthStrip percent={flr.flrPercent} href="/flr" />
        </>
      ) : null}

      {/* Costs as a share of nett sales, the month up to the picked day */}
      {costs ? (
        <>
          <div className="sechead">
            <p className="rowlabel">Costs · {monthOf(costsDay)}, {upTo(costsDay, costs.dayNo)} · % of nett sales</p>
            <DayPicker param="costs" day={costsDay} today={today} yesterday={yesterday} />
          </div>
          <div className="grid">
            <Stat label="Food cost" value={share(costs.food)} sub={`${rm(costs.food)} · ${costs.foodFrom}`} href="/cogs" />
            <Stat label="Labour cost" value={share(costs.labour)} sub={costs.costsKeyed ? rm(costs.labour) : 'Not keyed in yet'} href="/flr" />
            <Stat label="Rental cost" value={share(costs.rent)} sub={costs.costsKeyed ? rm(costs.rent) : 'Not keyed in yet'} href="/flr" />
            <Stat label="Total cost" value={share(costs.total)} sub={`${rm(costs.total)} of ${rm(costs.netSales)} nett sales`} />
          </div>
          {costs.foodNote ? <p className="cap">{costs.foodNote}</p> : null}
          {costs.costsKeyed && costs.dayNo < costs.days ? <p className="cap">Labour and rental count {costs.dayNo} of {costs.days} days of the month.</p> : null}
        </>
      ) : null}

      {/* Row 3 — what's waiting on an owner */}
      <p className="rowlabel">Waiting on you</p>
      <div className="grid">
        <Stat label="Invoices paid" value={rm(cashIn)} />
        <Stat label="Pending leave approval" value={leave} yes={leave > 0} href="/hr/leave" />
        <Stat label="Approval" value={waiting} yes={waiting > 0} href="/approvals" />
      </div>

      {/* Row 2 — the latest Daily Report against the day before */}
      {reports ? (
        <>
          <p className="rowlabel">Daily report · {reports.day}, compared with {reports.previousDay}</p>
          <div className="grid">
            {DAILY_TILES.map(f => {
              const show = (n: number) => ('isCount' in f ? n.toLocaleString('en-MY') : rm(n))
              const now = Number(reports.latest[f.key])
              return (
                <Stat
                  key={f.key}
                  label={f.label.replace(' (RM)', '')}
                  value={now < 0 ? `-${show(-now)}` : show(now)}
                  sub={reports.previous ? changeText(now, Number(reports.previous[f.key]), show) : 'No report the day before'}
                  href={`/report?day=${reports.day}`}
                />
              )
            })}
          </div>
        </>
      ) : (
        <>
          <p className="rowlabel">Daily report</p>
          <p className="cap">No report saved yet. <a href="/report">Key in today&apos;s report</a></p>
        </>
      )}
    </>
  )
}

import { getRecords, isCashReceived, rm, todayISO } from '@/lib/records'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import Stat from '@/app/_components/Stat'
import { DAILY_TILES, SALES_COLUMNS, changeText, type SalesValues } from '@/app/report/fields'
import HealthStrip from '@/app/flr/HealthStrip'
import { flrFor } from '@/lib/flr'

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

// The last month closed in the TMS report. Costs only exist once a month is closed,
// so this is the last full month, not this one.
async function latestCosts() {
  if (!supabaseConfigured) return null
  const { data } = await supabase
    .from('monthly_pnl')
    .select('month, net_sales, cogs, labor, rent')
    .gt('net_sales', 0)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

type Takings = { nett: number; service: number; sst: number }
const addUp = (rows: { net_sales: number; service_charge: number; sst: number }[]): Takings =>
  rows.reduce((t, r) => ({ nett: t.nett + Number(r.net_sales), service: t.service + Number(r.service_charge), sst: t.sst + Number(r.sst) }), { nett: 0, service: 0, sst: 0 })

// Yesterday and the month so far, from daily_sales (GeniusPOS each morning, or the X
// Reading imports). Service charge and SST are what the POS actually charged.
async function takings() {
  if (!supabaseConfigured) return null
  const yesterday = dayBefore(todayISO())
  const month = yesterday.slice(0, 7)
  const [{ data }, { data: latest }] = await Promise.all([
    supabase.from('daily_sales').select('sale_date, net_sales, service_charge, sst').gte('sale_date', `${month}-01`).lte('sale_date', yesterday),
    supabase.from('daily_sales').select('sale_date').order('sale_date', { ascending: false }).limit(1),
  ])
  const rows = data ?? []
  const day = rows.find(r => r.sale_date === yesterday)
  return {
    yesterday, month, days: rows.length, lastDate: latest?.[0]?.sale_date as string | undefined,
    day: day ? addUp([day]) : null,
    monthToDate: addUp(rows),
  }
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function TakingsRow({ label, t }: { label: string; t: Takings }) {
  return (
    <>
      <p className="rowlabel">{label}</p>
      <div className="grid">
        <Stat label="Nett sales" value={rm(t.nett)} />
        <Stat label="Service charge 10%" value={rm(t.service)} />
        <Stat label="SST 6%" value={rm(t.sst)} />
        <Stat label="Total sales" value={rm(t.nett + t.service + t.sst)} sub="Nett + service charge + SST" />
      </div>
    </>
  )
}

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

export default async function Dashboard() {
  const [rows, waiting, sales, leave, costs, reports, flr] = await Promise.all([
    getRecords(), proposedCount(), takings(), leaveWaiting(), latestCosts(), latestReports(),
    supabaseConfigured ? flrFor(todayISO().slice(0, 7), todayISO()) : null,
  ])
  const monthName = sales
    ? new Date(`${sales.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : ''
  const share = (amount: number) => `${((amount / Number(costs?.net_sales)) * 100).toFixed(1)}%`
  const totalCost = Number(costs?.cogs) + Number(costs?.labor) + Number(costs?.rent)
  const costMonth = costs
    ? new Date(`${costs.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : ''

  const cashIn = rows.filter(isCashReceived).reduce((s, r) => s + Number(r.amount || 0), 0)

  return (
    <>
      <h1 className="ph">Dashboard</h1>
      <p className="cap">Costs, sales and what's waiting on you.</p>

      <p className="cap">
        {sales?.lastDate ? `Sales logged up to ${sales.lastDate}.` : 'No sales logged yet.'}
      </p>

      {/* Row 0 — costs as a share of net sales, last closed month */}
      {costs ? (
        <>
          <p className="rowlabel">Costs · {costMonth} · % of net sales</p>
          <div className="grid">
            <Stat label="Food cost" value={share(Number(costs.cogs))} sub={rm(Number(costs.cogs))} />
            <Stat label="Labour cost" value={share(Number(costs.labor))} sub={rm(Number(costs.labor))} />
            <Stat label="Rental cost" value={share(Number(costs.rent))} sub={rm(Number(costs.rent))} />
            <Stat label="Total cost" value={share(totalCost)} sub={rm(totalCost)} />
          </div>
        </>
      ) : null}

      {/* Rows 1 and 2 — yesterday, then the month so far: nett, service charge, SST, total */}
      {sales ? (
        <>
          {sales.day
            ? <TakingsRow label={`Sales Overview · Yesterday, ${shortDate(sales.yesterday)}`} t={sales.day} />
            : <p className="rowlabel">Sales Overview · Yesterday, {shortDate(sales.yesterday)}: no sales logged</p>}
          <TakingsRow label={`Sales Overview · ${monthName} so far (${sales.days} days)`} t={sales.monthToDate} />
        </>
      ) : null}

      {/* FLR this month: green under 70%, red over. Opens the FLR Report. */}
      {flr ? (
        <>
          <p className="rowlabel">FLR · {new Date(`${todayISO().slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} so far</p>
          <HealthStrip percent={flr.flrPercent} href="/flr" />
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

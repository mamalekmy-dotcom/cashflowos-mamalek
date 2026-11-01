import Link from 'next/link'
import { getRecords, getFunnel, isCashReceived, latestMonthSales, rm } from '@/lib/records'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import FunnelBar from '@/app/_components/FunnelBar'
import Stat from '@/app/_components/Stat'

export const dynamic = 'force-dynamic'

// Count of proposals still waiting on a human YES — the 🙋 number. Guarded so an
// unconfigured/placeholder Supabase returns 0 instantly instead of hanging.
async function proposedCount(): Promise<number> {
  if (!supabaseConfigured) return 0
  const { count, error } = await supabase
    .from('agent_actions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'proposed')
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

export default async function Dashboard() {
  const [rows, waiting, sales, leave, costs] = await Promise.all([
    getRecords(), proposedCount(), latestMonthSales(), leaveWaiting(), latestCosts(),
  ])
  const funnel = getFunnel(rows)
  const share = (amount: number) => `${((amount / Number(costs?.net_sales)) * 100).toFixed(1)}%`
  const costMonth = costs
    ? new Date(`${costs.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : ''

  // ── The Money row ───────────────────────────────────────────────
  const sum = (cat: string, statuses?: string[]) =>
    rows
      .filter(r => r.category === cat && (!statuses || statuses.includes((r.status || '').toLowerCase())))
      .reduce((s, r) => s + Number(r.amount || 0), 0)

  const cashIn = rows.filter(isCashReceived).reduce((s, r) => s + Number(r.amount || 0), 0)
  const cashOut = sum('cash_out')
  const net = cashIn - cashOut
  // "Who owes me" = money-in that hasn't landed yet (waiting / overdue / unpaid).
  const owed = sum('cash_in', ['waiting', 'overdue', 'unpaid', 'pending'])

  return (
    <>
      <h1 className="ph">Dashboard</h1>
      <p className="cap">Costs, the river, the money, and what needs your YES.</p>

      <p className="cap">
        {sales ? `Sales logged up to ${sales.lastDate}. ` : 'No sales logged yet. '}
        <Link href="/pulse">Log sales</Link> · <Link href="/clock">Clock in</Link>
      </p>

      {/* Row 0 — costs as a share of net sales, last closed month */}
      {costs ? (
        <>
          <p className="rowlabel">Costs · {costMonth} · % of net sales</p>
          <div className="grid">
            <Stat label="Food cost" value={share(Number(costs.cogs))} sub={rm(Number(costs.cogs))} href="/pulse" />
            <Stat label="Labour cost" value={share(Number(costs.labor))} sub={rm(Number(costs.labor))} href="/pulse" />
            <Stat label="Rental cost" value={share(Number(costs.rent))} sub={rm(Number(costs.rent))} href="/pulse" />
          </div>
        </>
      ) : null}

      {/* Row 1 — the funnel (whole-business river) */}
      <FunnelBar funnel={funnel} />

      {/* Row 2 — the money + the 🙋 count */}
      <p className="rowlabel">The Money</p>
      <div className="grid">
        {sales ? <Stat label={`Sales ${sales.month}`} value={rm(sales.total)} href="/pulse" /> : null}
        <Stat label="Invoices paid" value={rm(cashIn)} />
        <Stat label="Cash Out" value={rm(cashOut)} />
        <Stat label="Net" value={rm(net)} />
        <Stat label="Who Owes Me" value={rm(owed)} />
        <Stat label="🙋 Needs your YES" value={waiting} yes={waiting > 0} href="/approvals" />
        <Stat label="Leave to approve" value={leave} yes={leave > 0} href="/hr/leave" />
      </div>
    </>
  )
}

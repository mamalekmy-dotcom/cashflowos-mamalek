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

export default async function Dashboard() {
  const [rows, waiting, sales] = await Promise.all([getRecords(), proposedCount(), latestMonthSales()])
  const funnel = getFunnel(rows)

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
      <p className="cap">The river, the money, and what needs your YES.</p>

      <p className="cap">
        {sales ? `Sales logged up to ${sales.lastDate}. ` : 'No sales logged yet. '}
        <Link href="/pulse">Log sales</Link> · <Link href="/clock">Clock in</Link>
      </p>

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
      </div>
    </>
  )
}

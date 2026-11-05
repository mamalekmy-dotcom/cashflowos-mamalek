// 👉 Marketing lane (owner: Calixto95). A normal tab — reads the ONE `records`
// table, filters to category==='campaign', and shows ad campaigns with their
// budget, spend, leads and cost per lead, plus a per-channel breakdown.
// Custom fields live in `meta`: channel, spent, leads. Budget is `amount`,
// the end date is `due_date`, and status moves planned → running → ended.
// Ad spend here is for TRACKING only — it does not feed Cash Out or the Net.
import { getRecords, m, rm } from '@/lib/records'
import Empty from '@/app/_components/Empty'
import Stat from '@/app/_components/Stat'
import { CHANNELS, channelOf, costPerLead, num, pillFor } from './_parts/campaign'

export const dynamic = 'force-dynamic'

export default async function Marketing() {
  const all = await getRecords()
  const rows = all
    .filter(r => r.category === 'campaign')
    // Soonest end date first; undated rows sink to the bottom.
    .sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1))

  const running = rows.filter(r => (r.status || '').toLowerCase() === 'running').length
  const budget = rows.reduce((s, r) => s + num(r.amount), 0)
  const spent = rows.reduce((s, r) => s + num(r.meta?.spent), 0)
  const leads = rows.reduce((s, r) => s + num(r.meta?.leads), 0)

  // The big three ad platforms always show (so a zero is visible), then any
  // other channel that appears in the data.
  const seen = Array.from(new Set(rows.map(channelOf)))
  const channels = [...CHANNELS, ...seen.filter(c => !CHANNELS.includes(c))]
  const byChannel = channels.map(name => {
    const mine = rows.filter(r => channelOf(r) === name)
    return {
      name,
      count: mine.length,
      budget: mine.reduce((s, r) => s + num(r.amount), 0),
      spent: mine.reduce((s, r) => s + num(r.meta?.spent), 0),
      leads: mine.reduce((s, r) => s + num(r.meta?.leads), 0),
    }
  })

  return (
    <>
      <h1 className="ph">Marketing 📈</h1>
      <p className="cap">Your ad campaigns — Google, Meta, TikTok and more: budget, spend and what each lead costs.</p>

      <div className="grid">
        <Stat label="Running now" value={running} />
        <Stat label="Total budget" value={rm(budget)} />
        <Stat label="Spent so far" value={rm(spent)} />
        <Stat label="Cost per lead" value={costPerLead(spent, leads)} />
      </div>

      {rows.length === 0 ? (
        <Empty label="campaigns" />
      ) : (
        <>
          <p className="rowlabel">Spend by channel</p>
          <table className="tbl" style={{ marginBottom: 24 }}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Campaigns</th>
                <th>Budget</th>
                <th>Spent</th>
                <th>Leads</th>
                <th>Cost per lead</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map(c => (
                <tr key={c.name}>
                  <td data-label="Channel">{c.name}</td>
                  <td data-label="Campaigns">{c.count}</td>
                  <td data-label="Budget">{rm(c.budget)}</td>
                  <td data-label="Spent">{rm(c.spent)}</td>
                  <td data-label="Leads">{c.leads}</td>
                  <td data-label="Cost per lead">{costPerLead(c.spent, c.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="rowlabel">Campaigns</p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Ends</th>
                <th>Budget</th>
                <th>Spent</th>
                <th>Leads</th>
                <th>Cost per lead</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td data-label="Campaign">{r.title}</td>
                  <td data-label="Channel">{m(r, 'channel')}</td>
                  <td data-label="Status">
                    <span className={`pill ${pillFor(r.status)}`}>{r.status || '—'}</span>
                  </td>
                  <td data-label="Ends">{r.due_date ?? '—'}</td>
                  <td data-label="Budget">{rm(num(r.amount))}</td>
                  <td data-label="Spent">{rm(num(r.meta?.spent))}</td>
                  <td data-label="Leads">{num(r.meta?.leads)}</td>
                  <td data-label="Cost per lead">{costPerLead(num(r.meta?.spent), num(r.meta?.leads))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

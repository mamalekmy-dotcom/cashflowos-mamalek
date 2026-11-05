import Link from 'next/link'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { todayISO } from '@/lib/records'
import { financeReadout } from '@/lib/finance-head'
import { FINANCE_HEAD as F } from '@/agents/finance-head/definition'
import CsuiteMap from './CsuiteMap'

export const dynamic = 'force-dynamic'

// The AI C Suite: you're the CEO, Jarvis Oyen runs the line, and 4 department heads
// read the business and bring you ONE recommendation each. They recommend, you decide
// (docs/ai-csuite-blueprint.md). Head #1, Finance, is live; the rest are next.

const STATE: Record<string, { cls: string; word: string }> = {
  firing: { cls: 'pending', word: '🔔 Over the line' },
  ok: { cls: 'done', word: 'OK' },
  nodata: { cls: 'nurture', word: 'No data yet' },
}

const NEXT = [
  { emoji: '⚙️', name: 'Ops', owner: 'You and Su Ni', when: 'a task is 2+ days overdue', look: 'Tasks and Doc Center', needs: 'The team logging tasks in the app (0 so far)' },
  { emoji: '📣', name: 'Marketing', owner: 'Teo Wee Chian', when: 'a post sits in draft for 7+ days', look: 'Content', needs: "Teo's OK, and posts logged in Content (0 so far)" },
  { emoji: '🎯', name: 'Sales', owner: 'Lee Zhi Xiang', when: 'a regular hasn’t come back in 30 days', look: 'CRM customers', needs: "Lee's OK, and the CRM tab with customer visits" },
]

async function recentDecisions() {
  if (!supabaseConfigured) return []
  const { data } = await supabase
    .from('agent_actions')
    .select('id, status, payload, proposed_at')
    .eq('agent_key', F.key)
    .order('proposed_at', { ascending: false })
    .limit(6)
  return data ?? []
}

export default async function Csuite() {
  const today = todayISO()
  const [{ readings, alarms }, decisions] = await Promise.all([
    financeReadout(today).catch(e => {
      console.error('[CFO] finance readout failed:', e)
      return { readings: [], alarms: [] }
    }),
    recentDecisions(),
  ])

  return (
    <>
      <h1 className="ph">AI C Suite 🏛️</h1>
      <p className="cap">You&apos;re the CEO. Your heads read the numbers and bring you one recommendation each. You keep every YES.</p>

      <CsuiteMap findings={alarms.map(a => a.s.title)} live={['finance']} />

      <section className="cs-card">
        <p className="ac-name">
          <span aria-hidden="true">💰</span> Head of Finance <span className="tag live">Live</span>
          <span className="cs-when">Reports 9am daily with your morning brief</span>
        </p>
        <div className="cs-knobs">
          <div><b>1) When</b><span>a line below is crossed</span></div>
          <div><b>2) Look at</b><span>POS sales, supplier bills, TMS P&amp;L, FLR labour</span></div>
          <div><b>3) Suggest</b><span>one fix a day, biggest RM first, with a draft message</span></div>
          <div><b>4) Ask before</b><span>everything. Approve adds a task + gives you the draft</span></div>
        </div>

        <table className="tbl cs-tbl">
          <thead><tr><th>Watching</th><th>Now</th><th>Line</th><th>Status</th></tr></thead>
          <tbody>
            {readings.map(r => (
              <tr key={r.kind}>
                <td data-label="Watching">{r.label}</td>
                <td data-label="Now" className="figure">{r.value}</td>
                <td data-label="Line">{r.line}</td>
                <td data-label="Status"><span className={`pill ${STATE[r.state].cls}`}>{STATE[r.state].word}</span></td>
              </tr>
            ))}
          </tbody>
        </table>

        {alarms.length ? (
          <div className="cs-top">
            <p className="rowlabel">Biggest problem right now</p>
            <p className="cs-top-t">{alarms[0].s.title}</p>
            <p className="ac-role figure">{alarms[0].s.why}</p>
            <p className="ac-role">👉 {alarms[0].s.suggest}</p>
            {alarms.length > 1 ? <p className="ac-lastrun">Also on the radar: {alarms.slice(1, 4).map(a => a.s.title).join(' · ')}</p> : null}
          </div>
        ) : (
          <p className="ac-role cs-top">All lines OK today. Nothing for you to decide.</p>
        )}

        <p className="rowlabel" style={{ marginTop: 18 }}>Recent recommendations</p>
        {decisions.length ? (
          <table className="tbl">
            <tbody>
              {decisions.map(d => (
                <tr key={d.id}>
                  <td data-label="Date">{String(d.proposed_at).slice(0, 10)}</td>
                  <td data-label="What">{d.payload?.note || '—'}</td>
                  <td data-label="Status"><span className={`pill ${d.status}`}>{d.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ac-lastrun">None yet. The first one arrives at 9am on Telegram, or in <Link href="/approvals">Approvals</Link>.</p>
        )}
      </section>

      <p className="rowlabel">Next heads, one by one</p>
      <div className="cs-next">
        {NEXT.map(h => (
          <div className="cs-card soon" key={h.name}>
            <p className="ac-name"><span aria-hidden="true">{h.emoji}</span> Head of {h.name} <span className="tag soon">Coming next</span></p>
            <p className="ac-role"><b>When</b> {h.when}</p>
            <p className="ac-role"><b>Look at</b> {h.look}</p>
            <p className="ac-lastrun">Owner: {h.owner}. Needs: {h.needs}.</p>
          </div>
        ))}
      </div>

      <p className="cs-never">🔴 No head ever sends a message, moves money or deletes anything. They draft. You send.</p>
    </>
  )
}

import Link from 'next/link'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { todayISO } from '@/lib/records'
import { financeReadout } from '@/lib/finance-head'
import { opsReadout } from '@/lib/ops-head'
import { salesReadout } from '@/lib/sales-head'
import { marketingReadout } from '@/lib/marketing-head'
import type { Readout } from '@/lib/heads'
import CsuiteMap from './CsuiteMap'
import NameForm from './NameForm'
import { getAssistantName } from '@/lib/assistant-name'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The AI C Suite: you're the CEO, your chief of staff runs the line, and 4 department
// heads read the business and bring you ONE recommendation each a day. They recommend,
// you decide (docs/ai-csuite-blueprint.md). Lines: agents/<head>/definition.ts.

const STATE: Record<string, { cls: string; word: string }> = {
  firing: { cls: 'pending', word: '🔔 Over the line' },
  ok: { cls: 'done', word: 'OK' },
  nodata: { cls: 'nurture', word: 'No data yet' },
}

type HeadKey = 'finance' | 'ops' | 'sales' | 'marketing'
type Head = { key: HeadKey; agent: string; emoji: string; name: string; look: string; when: string; read: (today: string) => Promise<Readout> }

const HEADS: Head[] = [
  { key: 'finance', agent: 'finance-head', emoji: '💰', name: 'Finance', look: 'POS sales, supplier bills, TMS P&L, FLR labour', when: 'Reports 9am daily with your morning brief', read: financeReadout },
  { key: 'ops', agent: 'ops-head', emoji: '⚙️', name: 'Ops', look: 'Clock-ins, bills waiting, leave requests, food cost', when: 'Reports 9am daily', read: opsReadout },
  { key: 'sales', agent: 'sales-head', emoji: '🎯', name: 'Sales', look: 'POS sales, receipts and customers (pax)', when: 'Reports 9am daily', read: salesReadout },
  { key: 'marketing', agent: 'marketing-head', emoji: '📣', name: 'Marketing', look: 'Agency and ads spend, customers, discounts, reviews', when: 'Reports 9am daily', read: marketingReadout },
]

async function recentDecisions() {
  if (!supabaseConfigured) return []
  const { data } = await supabase
    .from('agent_actions')
    .select('id, agent_key, status, payload, proposed_at')
    .in('agent_key', HEADS.map(h => h.agent))
    .order('proposed_at', { ascending: false })
    .limit(10)
  return data ?? []
}

function HeadCard({ head, out }: { head: Head; out: Readout }) {
  const { readings, alarms } = out
  return (
    <section className="cs-card">
      <p className="ac-name">
        <span aria-hidden="true">{head.emoji}</span> Head of {head.name} <span className="tag live">Live</span>
        <span className="cs-when">{head.when}</span>
      </p>
      <p className="ac-role"><b>Looks at</b> {head.look}. <b>Suggests</b> one fix a day with a draft message. <b>Asks before</b> everything.</p>
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
    </section>
  )
}

export default async function Csuite() {
  const today = todayISO()
  const [outs, decisions, name] = await Promise.all([
    Promise.all(HEADS.map(h => h.read(today).catch(e => {
      console.error(`[CFO] ${h.name} readout failed:`, e)
      return { readings: [], alarms: [] } as Readout
    }))),
    recentDecisions(),
    getAssistantName(),
  ])
  const findings = HEADS.flatMap((h, i) => outs[i].alarms.slice(0, 1).map(a => ({ head: h.key, text: a.s.title })))
  const headOf = (agent: string) => HEADS.find(h => h.agent === agent)

  return (
    <>
      <h1 className="ph">AI C Suite 🏛️</h1>
      <p className="cap">You&apos;re the CEO. Your heads read the numbers and bring you one recommendation each a day. You keep every YES.</p>

      <NameForm name={name} />
      <CsuiteMap findings={findings} live={HEADS.map(h => h.key)} name={name} />

      {HEADS.map((h, i) => <HeadCard key={h.key} head={h} out={outs[i]} />)}

      <section className="cs-card">
        <p className="rowlabel">Recent recommendations</p>
        {decisions.length ? (
          <table className="tbl">
            <tbody>
              {decisions.map(d => (
                <tr key={d.id}>
                  <td data-label="Date">{String(d.proposed_at).slice(0, 10)}</td>
                  <td data-label="Head">{headOf(d.agent_key)?.emoji} {headOf(d.agent_key)?.name}</td>
                  <td data-label="What">{d.payload?.note || '—'}</td>
                  <td data-label="Status"><span className={`pill ${d.status}`}>{d.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ac-lastrun">None yet. They arrive at 9am on Telegram, or in <Link href="/approvals">Approvals</Link>.</p>
        )}
      </section>

      <p className="cs-never">🔴 No head ever sends a message, moves money or deletes anything. They draft. You send.</p>
    </>
  )
}

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { NOT_STOCK } from '@/lib/stock-logic'
import { ClaimForm, ScanForm } from './ScanForms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // reading a bill and asking the owner takes a few seconds

type Line = { text: string; item?: string; qty: number | null; unit: string; amount: number | null }
type Flow = { agent_key: string; status: string; payload: any; proposed_at: string; expires_at: string }

// Where a scanned supplier bill is up to on its way to the stock sheet.
function flowStatus(f: Flow | undefined): string | null {
  if (!f) return null
  if (f.status === 'proposed' && new Date(f.expires_at).getTime() <= Date.now()) return 'expired'
  if (f.agent_key === 'stock-draft') return f.status === 'proposed' ? 'owner checking' : 'closed'
  if (f.status === 'proposed') return 'waiting approval'
  if (f.status === 'executed') return 'recorded'
  return f.status
}

// Team only see their own scans. The full cabinet is Doc Center.
export default async function Scan() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const { data } = await supabase
    .from('documents')
    .select('id, kind, status, merchant, note, amount, created_at')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(30)

  // The newest stock step for each scan: a question still open, or the Approve card.
  const ids = (data ?? []).map(d => String(d.id))
  const { data: flows } = ids.length
    ? await supabase.from('agent_actions').select('agent_key, status, payload, proposed_at, expires_at')
      .in('agent_key', ['stock-draft', 'stock-receipt']).in('payload->>scanDocId', ids)
      .order('proposed_at', { ascending: true })
    : { data: [] }
  const latest = new Map<string, Flow>()
  for (const f of (flows ?? []) as Flow[]) latest.set(String(f.payload?.scanDocId), f)

  return (
    <>
      <h1 className="ph">Scan</h1>
      <p className="cap">Send in invoices, receipts and claims. Supplier bills go to the owner to approve for the stock sheet.</p>
      <ScanForm />
      <ClaimForm today={todayISO()} />
      {data?.length ? (
        <table className="tbl" style={{ maxWidth: 640 }}>
          <thead><tr><th>What</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {data.map(d => {
              const flow = latest.get(String(d.id))
              const lines: Line[] = flow?.agent_key === 'stock-receipt' ? flow.payload.lines ?? [] : flow?.payload?.bill?.lines ?? []
              const status = flowStatus(flow) ?? d.status
              return (
                <tr key={d.id}>
                  <td data-label="What">
                    {d.merchant ?? d.note ?? d.kind}
                    {lines.length ? (
                      <ul className="cap" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {lines.map((l, i) => (
                          <li key={i}>
                            {l.item && l.item !== NOT_STOCK ? l.item : l.text}
                            {l.item === NOT_STOCK ? ' (Others)' : ''}: {l.qty ?? '?'} {l.unit} · {l.amount != null ? rm(Number(l.amount)) : '?'}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td data-label="Amount">{d.amount != null ? rm(Number(d.amount)) : '—'}</td>
                  <td data-label="Status"><span className={`pill ${status.replace(/\s/g, '-')}`}>{status}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </>
  )
}

import { requireOwner } from '@/lib/auth'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { hasPin, isUnlocked } from './actions'
import { PinForm, ReviewDoc, type DocRow } from './DocForms'

export const dynamic = 'force-dynamic'

const SIGNED_URL_SECONDS = 600

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from('vault').createSignedUrl(path, SIGNED_URL_SECONDS)
  return data?.signedUrl ?? null
}

export default async function DocCenter() {
  await requireOwner()
  if (!(await isUnlocked())) {
    return (
      <>
        <h1 className="ph">Doc Center</h1>
        <p className="cap">Team only see their own scans. This PIN protects the full cabinet.</p>
        <PinForm firstTime={!(await hasPin())} />
      </>
    )
  }

  const { data } = await supabase
    .from('documents')
    .select('id, kind, status, merchant, note, amount, doc_date, storage_path, created_at, app_users(name)')
    .order('created_at', { ascending: false })
    .limit(100)
  const rows = data ?? []
  const byName = (row: (typeof rows)[number]) =>
    (row.app_users as unknown as { name: string } | null)?.name ?? 'Unknown'

  const waiting: DocRow[] = await Promise.all(
    rows.filter(r => r.status === 'new').map(async r => ({
      id: r.id,
      kind: r.kind,
      merchant: r.merchant,
      note: r.note,
      amount: r.amount,
      doc_date: r.doc_date,
      url: await signed(r.storage_path),
      by: byName(r),
    })),
  )
  const decided = rows.filter(r => r.status !== 'new')

  return (
    <>
      <h1 className="ph">Doc Center</h1>
      <p className="cap">{waiting.length} waiting · {decided.length} decided</p>
      {waiting.map(doc => <ReviewDoc key={doc.id} doc={doc} today={todayISO()} />)}
      {decided.length ? (
        <table className="tbl" style={{ maxWidth: 640 }}>
          <thead><tr><th>What</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {decided.map(d => (
              <tr key={d.id}>
                <td data-label="What">{d.merchant ?? d.note ?? d.kind}</td>
                <td data-label="Date">{d.doc_date ?? '—'}</td>
                <td data-label="Amount">{d.amount != null ? rm(Number(d.amount)) : '—'}</td>
                <td data-label="Status"><span className={`pill ${d.status}`}>{d.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}

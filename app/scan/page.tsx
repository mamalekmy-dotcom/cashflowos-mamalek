import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { ClaimForm, ScanForm } from './ScanForms'

export const dynamic = 'force-dynamic'

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

  return (
    <>
      <h1 className="ph">Scan</h1>
      <p className="cap">Send in invoices, receipts and claims.</p>
      <ScanForm />
      <ClaimForm today={todayISO()} />
      {data?.length ? (
        <table className="tbl" style={{ maxWidth: 640 }}>
          <thead><tr><th>What</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {data.map(d => (
              <tr key={d.id}>
                <td data-label="What">{d.merchant ?? d.note ?? d.kind}</td>
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

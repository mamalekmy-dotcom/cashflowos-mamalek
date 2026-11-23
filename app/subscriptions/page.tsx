import { requireOwner } from '@/lib/auth'
import { daysUntil, listSubscriptions, money } from '@/lib/subscriptions'
import { todayISO } from '@/lib/records'
import SubForm from './SubForm'

export const dynamic = 'force-dynamic'

const shown = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export default async function Subscriptions() {
  await requireOwner()
  const today = todayISO()
  let subs: Awaited<ReturnType<typeof listSubscriptions>> = []
  let problem = ''
  try { subs = await listSubscriptions() } catch (e: any) { problem = e?.message || String(e) }

  const monthly = subs.filter(s => s.active && s.currency === 'MYR')
    .reduce((t, s) => t + (s.cycle === 'monthly' ? Number(s.amount) : s.cycle === 'yearly' ? Number(s.amount) / 12 : 0), 0)

  return (
    <>
      <h1 className="ph">Subscriptions</h1>
      <p className="cap">
        Every paid service and server, and when it renews. The bot reminds you, Su Ni and the team group 14 days, 3 days and on the day,
        then reminds you to send in the invoice for your claim.
      </p>
      {problem ? <p className="login-error">Could not load: {problem}</p> : null}
      <SubForm />
      {monthly ? <p className="cap">About {money({ amount: Math.round(monthly * 100) / 100, currency: 'MYR' })} a month in Ringgit subscriptions (yearly ones spread over 12 months).</p> : null}
      <table className="tbl" style={{ maxWidth: 820 }}>
        <thead><tr><th>Name</th><th>Amount</th><th>Renews</th><th>Next</th><th></th></tr></thead>
        <tbody>
          {subs.map(s => {
            const days = daysUntil(s.next_renewal, today)
            const soon = s.active && days <= 14
            return (
              <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                <td data-label="Name"><strong>{s.name}</strong>{s.notes ? <span className="cap"> · {s.notes}</span> : null}{s.active ? null : <span className="cap"> · no reminders</span>}</td>
                <td data-label="Amount">{money(s)}</td>
                <td data-label="Renews">{s.cycle === 'once' ? 'One-off' : s.cycle === 'yearly' ? 'Yearly' : 'Monthly'}</td>
                <td data-label="Next">
                  {soon ? <strong style={{ color: 'var(--rust)' }}>{shown(s.next_renewal)}</strong> : shown(s.next_renewal)}
                  {s.active ? <span className="cap"> · {days === 0 ? 'today' : days < 0 ? 'passed' : `in ${days} days`}</span> : null}
                </td>
                <td data-label="">
                  <SubForm sub={{
                    id: s.id, name: s.name, amount: Number(s.amount), currency: s.currency, cycle: s.cycle, next_renewal: s.next_renewal,
                    where_invoice: s.where_invoice ?? '', notes: s.notes ?? '', active: s.active,
                  }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

import { days, STATUS_LABEL, typeName, whenText, type LeaveRequest, type LeaveType, type LedgerLine } from '@/lib/hr/data'
import type { Balance } from '@/lib/hr/rules'
import { CancelButton } from './HRControls'

const KIND: Record<string, string> = {
  entitlement: 'Entitlement', accrual: 'Accrual', adjustment: 'Adjustment', taken: 'Taken', reversal: 'Given back',
}

// Balances, requests and the ledger behind them, for one person and one year.
// `canCancel` says which requests the viewer may cancel; the action checks again.
export default function LeaveSummary({ types, balances, requests, ledger, canCancel }: {
  types: LeaveType[]; balances: Balance[]; requests: LeaveRequest[]; ledger: LedgerLine[]
  canCancel: (r: LeaveRequest) => boolean
}) {
  return (
    <>
      {balances.length ? (
        <table className="tbl">
          <thead><tr><th>Leave</th><th>Entitled</th><th>Used</th><th>Waiting</th><th>Available</th></tr></thead>
          <tbody>
            {balances.map(b => (
              <tr key={b.leave_type}>
                <td data-label="Leave">{typeName(types, b.leave_type)}</td>
                <td data-label="Entitled">{b.entitled}</td>
                <td data-label="Used">{b.used}</td>
                <td data-label="Waiting">{b.pending}</td>
                <td data-label="Available"><strong>{b.available}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="cap">No leave set up yet.</p>}

      <p className="rowlabel" style={{ marginTop: 18 }}>Requests</p>
      {requests.length ? requests.map(r => (
        <div className="admin-card" key={r.id}>
          <p className="rowlabel" style={{ marginBottom: 2 }}>{typeName(types, r.leave_type)} · {days(r.days)} · {STATUS_LABEL[r.status] ?? r.status}</p>
          <p className="cap" style={{ margin: 0 }}>{whenText(r)}{r.reason ? ` · ${r.reason}` : ''}</p>
          {r.decision_note ? <p className="cap" style={{ margin: '4px 0 0' }}>Note: {r.decision_note}</p> : null}
          {canCancel(r) ? <div style={{ marginTop: 10 }}><CancelButton id={r.id} version={r.version} label={r.status === 'approved' ? 'Cancel and give days back' : 'Cancel request'} /></div> : null}
        </div>
      )) : <p className="cap">No requests this year.</p>}

      <details style={{ marginTop: 18 }}>
        <summary className="rowlabel">How the balance adds up</summary>
        {ledger.length ? (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Leave</th><th>What</th><th>Days</th><th>Note</th></tr></thead>
            <tbody>
              {ledger.map(l => (
                <tr key={l.id}>
                  <td data-label="Date">{l.created_at.slice(0, 10)}</td>
                  <td data-label="Leave">{typeName(types, l.leave_type)}</td>
                  <td data-label="What">{KIND[l.kind] ?? l.kind}</td>
                  <td data-label="Days">{Number(l.delta) > 0 ? `+${Number(l.delta)}` : Number(l.delta)}</td>
                  <td data-label="Note">{l.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="cap">Nothing yet.</p>}
      </details>
    </>
  )
}

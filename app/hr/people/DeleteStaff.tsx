'use client'
import { useState, useTransition } from 'react'
import { deleteStaff } from './delete-actions'

// "Delete staff" on a profile (owners only). Asks first, then goes back to People.
export default function DeleteStaff({ id, name, hasLogin }: { id: number; name: string; hasLogin: boolean }) {
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  return (
    <div className="admin-card" style={{ borderColor: 'rgba(169,83,63,.35)' }}>
      <p className="rowlabel" style={{ marginBottom: 4 }}>Delete staff</p>
      <p className="cap" style={{ marginTop: 0 }}>
        Removes {name} for good: profile and leave history{hasLogin ? ', plus their login, clock-ins and chats' : ''}. Can&apos;t be undone.
        If they just left, set Status to &quot;Left&quot; instead to keep their records.
      </p>
      <button type="button" className="btn danger" disabled={pending} onClick={() => {
        if (!confirm(`Delete ${name} for good? This can't be undone.`)) return
        run(async () => {
          const r = await deleteStaff(id)
          setMessage(r.message)
          if (r.ok) window.location.href = '/hr/people'
        })
      }}>{pending ? 'Deleting…' : `Delete ${name}`}</button>
      {message ? <p className="cap" style={{ margin: '8px 0 0' }}>{message}</p> : null}
    </div>
  )
}

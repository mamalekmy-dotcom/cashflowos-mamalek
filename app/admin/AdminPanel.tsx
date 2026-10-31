'use client'
import { useState, useTransition } from 'react'
import { GRANTABLE_TABS, ROLES, accessLevel } from '@/lib/access'
import { createUser, resetPassword, setActive, updateUser } from './actions'

export type PanelUser = {
  id: number
  name: string
  email: string
  role: string
  extra_tabs: string[]
  telegram_id: number | null
  active: boolean
}

type Result = { ok: boolean; message: string; tempPassword?: string }

const selectStyle = { marginTop: 10 }

function AddUser({ onResult }: { onResult: (r: Result) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [telegramId, setTelegramId] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await createUser({ name, email, role, telegramId })
      onResult(result)
      if (result.ok) {
        setName('')
        setEmail('')
        setTelegramId('')
      }
    })
  }

  return (
    <form onSubmit={submit} className="admin-card">
      <p className="rowlabel">Add a person</p>
      <input className="login-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <input className="login-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={selectStyle} />
      <select className="login-input" value={role} onChange={e => setRole(e.target.value)} style={selectStyle}>
        {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <input className="login-input" inputMode="numeric" placeholder="Telegram ID (optional)" value={telegramId} onChange={e => setTelegramId(e.target.value)} style={selectStyle} />
      <button className="btn" type="submit" disabled={pending || !name || !email} style={{ marginTop: 12 }}>
        {pending ? 'Adding…' : 'Add person'}
      </button>
    </form>
  )
}

function UserRow({ user, onResult }: { user: PanelUser; onResult: (r: Result) => void }) {
  const [role, setRole] = useState(user.role)
  const [extras, setExtras] = useState(user.extra_tabs)
  const [telegramId, setTelegramId] = useState(user.telegram_id ? String(user.telegram_id) : '')
  const [pending, start] = useTransition()

  const run = (action: () => Promise<Result>) => start(async () => onResult(await action()))
  const toggle = (href: string) =>
    setExtras(list => (list.includes(href) ? list.filter(t => t !== href) : [...list, href]))

  // A tab their role already gives them shows ticked and locked, so the ticks that
  // can change are only ever real extras.
  const fromRole = (href: string) => accessLevel({ role, extra_tabs: [] }, href) !== null

  return (
    <div className="admin-card" style={user.active ? undefined : { opacity: 0.6 }}>
      <p className="rowlabel" style={{ marginBottom: 2 }}>
        {user.name} {user.active ? null : <span className="pill overdue">disabled</span>}
      </p>
      <p className="cap" style={{ margin: '0 0 10px' }}>{user.email}</p>
      <select className="login-input" value={role} onChange={e => setRole(e.target.value)}>
        {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <input className="login-input" inputMode="numeric" placeholder="Telegram ID" value={telegramId} onChange={e => setTelegramId(e.target.value)} style={selectStyle} />
      <div className="admin-tabs">
        {GRANTABLE_TABS.map(tab => {
          const locked = fromRole(tab.href)
          return (
            <label key={tab.href} className="admin-tab">
              <input
                type="checkbox"
                checked={locked || extras.includes(tab.href)}
                disabled={locked}
                onChange={() => toggle(tab.href)}
              />
              {tab.label}
            </label>
          )
        })}
      </div>
      <div className="btnrow" style={{ flexWrap: 'wrap' }}>
        <button className="btn" type="button" disabled={pending} onClick={() => run(() => updateUser(user.id, { role, extraTabs: extras, telegramId }))}>
          Save
        </button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => run(() => resetPassword(user.id))}>
          New temp password
        </button>
        {user.active ? (
          <button className="btn danger" type="button" disabled={pending} onClick={() => run(() => setActive(user.id, false))}>
            Disable
          </button>
        ) : (
          <button className="btn ghost" type="button" disabled={pending} onClick={() => run(() => setActive(user.id, true))}>
            Enable
          </button>
        )}
      </div>
    </div>
  )
}

export default function AdminPanel({ users }: { users: PanelUser[] }) {
  const [result, setResult] = useState<Result | null>(null)

  return (
    <>
      {result ? (
        <div className="admin-card" role="status">
          <p className={result.ok ? 'rowlabel' : 'login-error'} style={{ margin: 0 }}>{result.message}</p>
          {result.tempPassword ? (
            <>
              <p className="cap" style={{ margin: '8px 0 4px' }}>
                Temporary password, shown only once. Send it to them privately. They&apos;ll choose their own at first login.
              </p>
              <code>{result.tempPassword}</code>
            </>
          ) : null}
        </div>
      ) : null}
      <AddUser onResult={setResult} />
      {users.map(user => <UserRow key={user.id} user={user} onResult={setResult} />)}
    </>
  )
}

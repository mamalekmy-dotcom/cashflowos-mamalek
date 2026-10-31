'use client'
import { useState } from 'react'
import { changePassword } from './actions'

export default function AccountForm({ mustChange }: { mustChange: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const result = await changePassword(current, next)
    setMessage(result.message)
    setBusy(false)
    if (result.ok) setTimeout(() => { window.location.href = '/login' }, 1200)
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => null)
    window.location.href = '/login'
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 360 }}>
      {mustChange ? (
        <p className="login-error" style={{ marginBottom: 12 }}>
          Please choose your own password before you continue.
        </p>
      ) : null}
      <input
        className="login-input"
        type="password"
        autoComplete="current-password"
        placeholder={mustChange ? 'Temporary password' : 'Current password'}
        value={current}
        onChange={e => setCurrent(e.target.value)}
      />
      <input
        className="login-input"
        type="password"
        autoComplete="new-password"
        placeholder="New password (at least 10 characters)"
        value={next}
        onChange={e => setNext(e.target.value)}
        style={{ marginTop: 10 }}
      />
      {message ? <p className="login-error">{message}</p> : null}
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn" type="submit" disabled={busy || !current || next.length < 10}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        <button className="btn ghost" type="button" onClick={logout}>Log out</button>
      </div>
    </form>
  )
}

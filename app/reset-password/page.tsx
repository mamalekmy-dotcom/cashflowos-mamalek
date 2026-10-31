'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

// The page the reset email links to. Supabase puts a one-time token after the # in
// the link, which never reaches server logs, and we post it back with the new password.
export default function ResetPassword() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const found = new URLSearchParams(window.location.hash.slice(1)).get('access_token')
    if (found) setToken(found)
    else setError('This link is missing its code. Ask for a new reset email.')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)
    const body = await res?.json().catch(() => ({}))
    if (body?.ok) setDone(true)
    else setError(body?.message || 'Something went wrong. Try again.')
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="ph" style={{ fontSize: 18, marginBottom: 16 }}>Choose a new password</h1>
        {done ? (
          <p className="cap" style={{ margin: 0 }}>
            Password changed. <Link href="/login">Log in</Link>
          </p>
        ) : (
          <>
            <input
              className="login-input"
              type="password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
            {error ? <p className="login-error">{error}</p> : null}
            <button className="btn" type="submit" disabled={busy || !token || password.length < 10} style={{ width: '100%', marginTop: 12 }}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}

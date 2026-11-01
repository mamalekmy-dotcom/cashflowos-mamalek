'use client'
import { useState } from 'react'
import Link from 'next/link'

// The login screen. On success the server sets the session cookie and tells us which
// page this person starts on. proxy.ts leaves this page open, since you can't log in
// through a locked login page.
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.ok) {
        window.location.href = body.home || '/'
        return
      }
      setError("That staff ID, email or password didn't match. Try again.")
    } catch {
      setError('Something went wrong reaching the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 8 }}>
          <img className="logo" src="/icons/logo.png" alt="" /> Mama Lek
        </div>
        <h1 className="ph" style={{ fontSize: 18, marginBottom: 16 }}>Log in</h1>
        <input
          className="login-input"
          type="text"
          autoCapitalize="none"
          autoComplete="username"
          placeholder="Staff ID or email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoFocus
        />
        <input
          className="login-input"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ marginTop: 10 }}
        />
        {error ? <p className="login-error">{error}</p> : null}
        <button className="btn" type="submit" disabled={busy || !email || !password} style={{ width: '100%', marginTop: 12 }}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
        <p className="cap" style={{ margin: '14px 0 0', textAlign: 'center' }}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
      </form>
    </div>
  )
}

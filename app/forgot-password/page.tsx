'use client'
import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    await fetch('/api/password/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    setSent(true)
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="ph" style={{ fontSize: 18 }}>Reset your password</h1>
        {sent ? (
          <p className="cap" style={{ margin: '8px 0 0' }}>
            If that email has an account, a reset link is on its way. Check your spam folder too.
          </p>
        ) : (
          <>
            <p className="cap" style={{ margin: '4px 0 16px' }}>We&apos;ll email you a link.</p>
            <input
              className="login-input"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
            />
            <button className="btn" type="submit" disabled={busy || !email} style={{ width: '100%', marginTop: 12 }}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}
        <p className="cap" style={{ margin: '14px 0 0', textAlign: 'center' }}>
          <Link href="/login">Back to login</Link>
        </p>
      </form>
    </div>
  )
}

'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { signUp } from './actions'

export default function JoinForm({ token, positions }: { token: string; positions: string[] }) {
  const [f, setF] = useState({ fullName: '', loginId: '', password: '', confirm: '', position: '', phone: '', telegramId: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [pending, run] = useTransition()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))

  if (done) {
    return (
      <>
        <h1 className="ph" style={{ fontSize: 18 }}>You&apos;re signed up 🎉</h1>
        <p className="cap">Log in with your login ID <b>{done}</b> and the password you chose.</p>
        <Link className="btn" href="/login" style={{ display: 'block', textAlign: 'center', marginTop: 12 }}>Go to log in</Link>
      </>
    )
  }

  return (
    <form onSubmit={e => {
      e.preventDefault()
      setError('')
      if (f.password !== f.confirm) { setError('The two passwords are not the same.'); return }
      run(async () => {
        const res = await signUp(token, f)
        if (res.ok && res.loginId) setDone(res.loginId)
        else setError(res.message)
      })
    }}>
      <h1 className="ph" style={{ fontSize: 18, marginBottom: 4 }}>Staff sign-up</h1>
      <p className="cap" style={{ marginTop: 0 }}>Make your own login for the Mama Lek app.</p>
      <label className="cap">Full name<input className="login-input" value={f.fullName} onChange={set('fullName')} autoComplete="name" required /></label>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Login ID you want (e.g. haziza)
        <input className="login-input" value={f.loginId} onChange={set('loginId')} autoCapitalize="none" autoComplete="username" required />
      </label>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Password (8+ characters)
        <input className="login-input" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required />
      </label>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Type the password again
        <input className="login-input" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required />
      </label>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Position
        <select className="login-input" value={f.position} onChange={set('position')} required>
          <option value="">Pick one</option>
          {positions.map(p => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Phone (optional)
        <input className="login-input" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" />
      </label>
      <label className="cap" style={{ display: 'block', marginTop: 10 }}>Telegram ID (optional)
        <input className="login-input" inputMode="numeric" value={f.telegramId} onChange={set('telegramId')} />
      </label>
      <p className="cap" style={{ margin: '4px 0 0' }}>To get it: open Telegram, message <b>@MamaLekCashFlowBot</b> with <code>/myid</code>, and copy the number.</p>
      {error ? <p className="login-error">{error}</p> : null}
      <button className="btn" type="submit" disabled={pending} style={{ width: '100%', marginTop: 14 }}>{pending ? 'Signing up…' : 'Sign up'}</button>
    </form>
  )
}

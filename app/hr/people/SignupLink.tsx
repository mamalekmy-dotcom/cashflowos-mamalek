'use client'
import { useEffect, useState, useTransition } from 'react'
import { renewSignupLink, setSignupEnabled } from './signup-actions'

// The link owners send to staff so they can sign themselves up.
export default function SignupLink({ path, enabled }: { path: string; enabled: boolean }) {
  const [origin, setOrigin] = useState('')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin}${path}`

  return (
    <div className="admin-card" style={{ maxWidth: 640 }}>
      <p className="rowlabel" style={{ marginBottom: 4 }}>Staff sign-up link {enabled ? null : <span className="pill overdue">off</span>}</p>
      <p className="cap" style={{ marginTop: 0 }}>
        Send this to new staff on WhatsApp or Lark. They pick their own login ID and password, no approval needed.
        You get a Telegram message for each sign-up; then key in their HR number below and tick &quot;Can send bills&quot; in Admin if needed.
      </p>
      <code style={{ display: 'block', wordBreak: 'break-all', margin: '6px 0 10px' }}>{url}</code>
      <div className="btnrow" style={{ flexWrap: 'wrap' }}>
        <button className="btn" type="button" disabled={pending || !enabled} onClick={async () => {
          try { await navigator.clipboard.writeText(url); setMessage('Link copied.') } catch { setMessage('Copy the link above by hand.') }
        }}>Copy link</button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => run(async () => setMessage((await setSignupEnabled(!enabled)).message))}>
          {enabled ? 'Turn off' : 'Turn on'}
        </button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => {
          if (!confirm('Make a new link? The old link will stop working.')) return
          run(async () => setMessage((await renewSignupLink()).message))
        }}>New link</button>
      </div>
      {message ? <p className="cap" style={{ margin: '8px 0 0' }}>{message}</p> : null}
    </div>
  )
}

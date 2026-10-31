'use client'
import { useState, useTransition } from 'react'
import { createReviewLink } from './actions'

export default function CreateQR() {
  const [label, setLabel] = useState('')
  const [platform, setPlatform] = useState('Google')
  const [reviewUrl, setReviewUrl] = useState('')
  const [gift, setGift] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => setMessage((await createReviewLink({ label, platform, reviewUrl, gift })).message))
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">Create QR</p>
      <input className="login-input" placeholder="Name, e.g. Table 1" aria-label="Name" value={label} onChange={e => setLabel(e.target.value)} />
      <select className="login-input" aria-label="Platform" value={platform} onChange={e => setPlatform(e.target.value)} style={{ marginTop: 10 }}>
        <option>Google</option>
        <option>小红书</option>
        <option>大众点评</option>
      </select>
      <input className="login-input" placeholder="Your review page link (https://...)" aria-label="Review page link" value={reviewUrl} onChange={e => setReviewUrl(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" placeholder="Gift shown at the end (optional)" aria-label="Gift" value={gift} onChange={e => setGift(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !label} style={{ marginTop: 12 }}>Create QR</button>
    </form>
  )
}

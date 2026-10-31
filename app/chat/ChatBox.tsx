'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendMessage } from './actions'

const REFRESH_MS = 6000

export default function ChatBox({ room, shared }: { room: string; shared: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [pending, start] = useTransition()

  // Team rooms have other people in them, so keep checking for new messages.
  useEffect(() => {
    if (!shared) return
    const timer = setInterval(() => router.refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [router, shared])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = text
    setText('')
    start(async () => { await sendMessage(room, body) })
  }

  return (
    <form className="btnrow" onSubmit={submit} style={{ maxWidth: 640, marginTop: 12 }}>
      <input className="login-input" placeholder="Message" aria-label="Message" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn" type="submit" disabled={pending || !text.trim()}>{pending ? '…' : 'Send'}</button>
    </form>
  )
}

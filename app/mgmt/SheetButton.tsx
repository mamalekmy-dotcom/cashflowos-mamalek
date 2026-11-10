'use client'
import { useState, useTransition } from 'react'
import { refreshSheet } from './actions'

export default function SheetButton({ url }: { url: string }) {
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  return (
    <p className="cap" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <a href={url} target="_blank" rel="noreferrer">Open the Google Sheet copy</a>
      <button className="btn ghost" type="button" disabled={pending} onClick={() => run(async () => setMessage((await refreshSheet()).message))}>
        {pending ? 'Updating…' : 'Update it now'}
      </button>
      {message ? <span>{message}</span> : <span>Updated every morning.</span>}
    </p>
  )
}

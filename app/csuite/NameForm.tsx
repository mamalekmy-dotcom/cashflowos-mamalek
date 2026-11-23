'use client'
import { useState, useTransition } from 'react'
import { saveAssistantName } from './actions'

// Rename the chief of staff (owners only; the page itself is owners only).
export default function NameForm({ name }: { name: string }) {
  const [value, setValue] = useState(name)
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  return (
    <form className="daypick" style={{ margin: '0 0 14px' }} onSubmit={e => {
      e.preventDefault()
      run(async () => setMessage((await saveAssistantName(value)).message))
    }}>
      <label className="cap" htmlFor="assistant-name">Chief of staff&apos;s name</label>
      <input id="assistant-name" className="login-input" style={{ width: 200, padding: '6px 10px' }} maxLength={30}
        value={value} onChange={e => setValue(e.target.value)} />
      <button className="btn ghost" type="submit" disabled={pending || !value.trim() || value.trim() === name}>
        {pending ? 'Saving…' : 'Rename'}
      </button>
      {message ? <span className="cap">{message}</span> : null}
    </form>
  )
}

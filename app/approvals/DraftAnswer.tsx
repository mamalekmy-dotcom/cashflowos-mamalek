'use client'
import { useState, useTransition } from 'react'
import { answerDraft } from './questions'

type Choice = { value: string; label: string }

// One waiting bill's question, answered from the app instead of Telegram.
export default function DraftAnswer({ id, ask, choices }: { id: number; ask: string; choices: Choice[] }) {
  const [pick, setPick] = useState(choices.length === 1 ? choices[0].value : '')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const send = (value: string) => run(async () => setMessage((await answerDraft(value)).message))
  return (
    <div style={{ marginTop: 8 }}>
      <p className="cap" style={{ margin: '0 0 6px' }}>{ask}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {choices.length > 1 ? (
          <select className="login-input" style={{ flex: '1 1 240px' }} value={pick} onChange={e => setPick(e.target.value)} aria-label={`Answer for bill ${id}`}>
            <option value="">Pick one…</option>
            {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : null}
        <button className="btn" type="button" disabled={pending || !pick} onClick={() => send(pick)}>
          {pending ? 'Saving…' : choices.length === 1 ? choices[0].label : 'Save answer'}
        </button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => send(`smi:${id}:0:c`)}>Cancel bill</button>
      </div>
      {message ? <p className="cap" style={{ margin: '6px 0 0' }}>{message}</p> : null}
    </div>
  )
}

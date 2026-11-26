'use client'
import { useState, useTransition } from 'react'
import { answerDraft } from './questions'

type Choice = { value: string; label: string; top?: boolean; quick?: boolean }

// One waiting bill's question, answered from the app instead of Telegram. Short lists are
// buttons. Long lists (stock items, suppliers, categories) are a search box: best guesses
// show first, type a few letters to find any other, tap to answer.
export default function DraftAnswer({ id, ask, choices }: { id: number; ask: string; choices: Choice[] }) {
  const [q, setQ] = useState('')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const send = (value: string) => run(async () => setMessage((await answerDraft(value)).message))

  const quick = choices.filter(c => c.quick)
  const rest = choices.filter(c => !c.quick)
  const searchable = rest.length > 6
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = words.length
    ? rest.filter(c => words.every(w => c.label.toLowerCase().includes(w))).slice(0, 12)
    : rest.filter(c => c.top).slice(0, 8)

  return (
    <div style={{ marginTop: 8 }}>
      <p className="cap" style={{ margin: '0 0 6px' }}>{ask}</p>
      {searchable ? (
        <>
          <input className="login-input" type="search" placeholder="Type to search, e.g. cabbage" value={q} autoComplete="off"
            onChange={e => setQ(e.target.value)} aria-label={`Search answers for bill ${id}`} />
          <p className="cap" style={{ margin: '6px 0 4px' }}>{words.length ? `${found.length ? 'Tap the right one' : 'No match. Try fewer letters.'}` : found.length ? 'Best guesses (or type to search all):' : 'Type to search.'}</p>
          <div className="chips">
            {found.map(c => <button key={c.value} type="button" className="chip" disabled={pending} onClick={() => send(c.value)}>{c.label}</button>)}
          </div>
        </>
      ) : null}
      <div className="btnrow" style={{ marginTop: 8 }}>
        {(searchable ? quick : [...quick, ...rest]).map(c => (
          <button key={c.value} type="button" className={c.quick ? 'btn ghost' : 'btn'} disabled={pending} onClick={() => send(c.value)}>{c.label}</button>
        ))}
        <button className="btn ghost" type="button" disabled={pending} onClick={() => send(`smi:${id}:0:c`)}>Cancel bill</button>
      </div>
      {pending ? <p className="cap" style={{ margin: '6px 0 0' }}>Saving…</p> : null}
      {message ? <p className="cap" style={{ margin: '6px 0 0' }}>{message}</p> : null}
    </div>
  )
}

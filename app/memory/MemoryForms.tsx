'use client'
import { useState, useTransition } from 'react'
import { addMemory, savePersona } from './actions'

const LANGUAGES = ['English', 'Bahasa Melayu', '中文（简体）', '中文（繁體）', 'ภาษาไทย']

export function PersonaForm({ name, language, manner }: { name: string; language: string; manner: string }) {
  const [values, setValues] = useState({ name, language, manner })
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues(v => ({ ...v, [key]: e.target.value }))

  return (
    <div className="admin-card">
      <p className="rowlabel">Your AI</p>
      <input className="login-input" placeholder="AI name" aria-label="AI name" value={values.name} onChange={set('name')} />
      <select className="login-input" aria-label="Language" value={values.language} onChange={set('language')} style={{ marginTop: 10 }}>
        {LANGUAGES.map(l => <option key={l}>{l}</option>)}
      </select>
      <input className="login-input" placeholder="How it should talk" aria-label="Manner" value={values.manner} onChange={set('manner')} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="button" disabled={pending} style={{ marginTop: 12 }} onClick={() => start(async () => setMessage((await savePersona(values.name, values.language, values.manner)).message))}>Save</button>
    </div>
  )
}

export function MemoryForm() {
  const [kind, setKind] = useState('dish')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await addMemory(kind, title, body)
      setMessage(result.message)
      if (result.ok) {
        setTitle('')
        setBody('')
      }
    })
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">Teach it something</p>
      <select className="login-input" aria-label="Type" value={kind} onChange={e => setKind(e.target.value)}>
        <option value="dish">Dish</option>
        <option value="phrase">Phrase we use</option>
        <option value="note">Shop note</option>
      </select>
      <input className="login-input" placeholder="Title" aria-label="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" placeholder="Details" aria-label="Details" value={body} onChange={e => setBody(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !title} style={{ marginTop: 12 }}>Save</button>
    </form>
  )
}

'use client'
import { useState, useTransition } from 'react'
import { addTask, completeTask, makeMyDay, polishTask } from './actions'

export function NewTask() {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [plan, setPlan] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await addTask(title, due)
      if (result.ok) {
        setTitle('')
        setDue('')
      }
    })
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">New task</p>
      <input className="login-input" placeholder="Type a to-do. It gets ranked A1, A2 or A3." value={title} onChange={e => setTitle(e.target.value)} />
      <input className="login-input" type="date" aria-label="Due date" value={due} onChange={e => setDue(e.target.value)} style={{ marginTop: 10 }} />
      <div className="btnrow" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={pending || !title.trim()}>Add task</button>
        <button className="btn ghost" type="button" disabled={pending || !title.trim()} onClick={() => start(async () => setTitle(await polishTask(title)))}>Polish</button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => start(async () => setPlan(await makeMyDay()))}>Make my day</button>
      </div>
      {plan ? <p className="cap" style={{ margin: '12px 0 0', whiteSpace: 'pre-line' }}>{plan}</p> : null}
    </form>
  )
}

export function DoneButton({ id }: { id: number }) {
  const [pending, start] = useTransition()
  return (
    <button className="btn ghost" type="button" disabled={pending} onClick={() => start(async () => { await completeTask(id) })}>Done</button>
  )
}

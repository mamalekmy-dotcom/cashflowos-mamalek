'use client'
import { useRef, useState, useTransition } from 'react'
import { scanDocument, submitClaim } from './actions'
import { toScan } from './scanner'

const MAX_FILES = 10
type Item = { id: string; file: File; preview: string | null; result?: string; ok?: boolean }

// Up to 10 bills at once: from the camera (one shot at a time, "Take another") or the
// gallery / files (several picked together). Photos are turned into clean black-and-white
// scans in the phone first (scanner.ts). Then they're sent one by one, each read on its own.
export function ScanForm() {
  const [items, setItems] = useState<Item[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const camera = useRef<HTMLInputElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const waiting = items.filter(i => i.result === undefined)

  const add = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    const room = MAX_FILES - waiting.length
    if (room <= 0) { setNote(`That's ${MAX_FILES} already. Send these first.`); return }
    setNote(picked.length > room ? `Only ${MAX_FILES} at a time, so the first ${room} were added.` : '')
    setBusy(true)
    setProgress('Scanning…')
    const ready: Item[] = []
    for (const f of picked.slice(0, room)) {
      const file = await toScan(f)
      ready.push({ id: `${Date.now()}-${Math.random()}`, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })
    }
    setItems(list => [...list.filter(i => i.result === undefined), ...ready])
    setBusy(false)
    setProgress('')
  }

  const remove = (id: string) => setItems(list => list.filter(i => i.id !== id))

  const sendAll = async () => {
    const queue = items.filter(i => i.result === undefined)
    setBusy(true)
    setNote('')
    for (let k = 0; k < queue.length; k++) {
      const it = queue[k]
      setProgress(`Reading ${k + 1} of ${queue.length}…`)
      const form = new FormData()
      form.append('file', it.file)
      let res: { ok: boolean; message: string }
      try { res = await scanDocument(form) } catch { res = { ok: false, message: 'Could not send. Check the connection and try again.' } }
      setItems(list => list.map(i => (i.id === it.id ? { ...i, result: res.message, ok: res.ok } : i)))
    }
    setProgress('')
    setBusy(false)
  }

  return (
    <div className="admin-card">
      <p className="rowlabel">Scan documents</p>
      <p className="cap" style={{ margin: '0 0 10px' }}>Receipts or invoices, photos or PDFs, up to {MAX_FILES} at once. Photos are cleaned up into black-and-white scans before sending.</p>
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={add} />
      <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={add} />
      <div className="btnrow" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={busy || waiting.length >= MAX_FILES} onClick={() => camera.current?.click()}>
          📷 {waiting.length ? 'Take another' : 'Take photo'}
        </button>
        <button type="button" className="btn ghost" disabled={busy || waiting.length >= MAX_FILES} onClick={() => upload.current?.click()}>📁 Choose files or photos</button>
      </div>

      {items.length ? (
        <div className="scan-tray">
          {items.map((it, k) => (
            <div key={it.id} className={`scan-item${it.result === undefined ? '' : it.ok ? ' done' : ' bad'}`}>
              {it.preview ? <img src={it.preview} alt={`Bill ${k + 1}`} /> : <span className="scan-pdf">PDF</span>}
              {it.result === undefined
                ? <button type="button" className="scan-x" aria-label="Remove" disabled={busy} onClick={() => remove(it.id)}>×</button>
                : <p className="cap">{it.ok ? '✅' : '⚠️'} {it.result}</p>}
            </div>
          ))}
        </div>
      ) : null}

      {waiting.length ? (
        <button type="button" className="btn" disabled={busy} onClick={sendAll} style={{ marginTop: 12, width: '100%' }}>
          Send {waiting.length} {waiting.length === 1 ? 'bill' : 'bills'}
        </button>
      ) : null}
      {progress ? <p className="cap" style={{ margin: '10px 0 0' }}>{progress}</p> : null}
      {note ? <p className="cap" style={{ margin: '10px 0 0' }}>{note}</p> : null}
    </div>
  )
}

export function ClaimForm({ today }: { today: string }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await submitClaim(Number(amount), note, date)
      setMessage(result.message)
      if (result.ok) {
        setAmount('')
        setNote('')
      }
    })
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">New claim</p>
      <input className="login-input" inputMode="decimal" placeholder="Amount (RM)" value={amount} onChange={e => setAmount(e.target.value)} />
      <input className="login-input" placeholder="What was it for?" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" type="date" aria-label="Date" value={date} onChange={e => setDate(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !amount || !note} style={{ marginTop: 12 }}>Send claim</button>
    </form>
  )
}

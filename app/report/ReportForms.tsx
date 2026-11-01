'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { addPurchase, removePurchase, saveSales } from './actions'
import { SALES_FIELDS, type SalesKey, type SalesValues } from './fields'

const gap = { marginTop: 10 }
const frame = { width: '100%', maxWidth: 360, borderRadius: 12, display: 'block', background: '#000' }

// Two ways in: the live camera, on a phone or a laptop, or a file already saved.
function InvoicePhoto({ photo, onChange }: { photo: File | null; onChange: (file: File | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [problem, setProblem] = useState('')
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : ''), [photo])

  useEffect(() => {
    if (!cameraOn) return
    let stream: MediaStream | null = null
    let stopped = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then(live => {
        if (stopped) return live.getTracks().forEach(t => t.stop())
        stream = live
        if (video.current) video.current.srcObject = live
      })
      .catch(() => {
        setProblem('Could not open the camera. Allow camera access, or use Upload file.')
        setCameraOn(false)
      })
    return () => {
      stopped = true
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [cameraOn])

  function snap() {
    const v = video.current
    if (!v?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob(blob => {
      if (blob) onChange(new File([blob], 'invoice.jpg', { type: 'image/jpeg' }))
      setCameraOn(false)
    }, 'image/jpeg', 0.85)
  }

  return (
    <div style={gap}>
      <p className="cap" style={{ margin: '0 0 6px' }}>Invoice photo (required)</p>
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Invoice" style={frame} />
          <button className="btn ghost" type="button" onClick={() => onChange(null)} style={gap}>Change photo</button>
        </>
      ) : cameraOn ? (
        <>
          <video ref={video} autoPlay playsInline muted style={frame} />
          <div className="btnrow" style={gap}>
            <button className="btn" type="button" onClick={snap}>Capture</button>
            <button className="btn ghost" type="button" onClick={() => setCameraOn(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="btnrow" style={{ flexWrap: 'wrap' }}>
          <button className="btn ghost" type="button" onClick={() => { setProblem(''); setCameraOn(true) }}>Take photo</button>
          <label className="btn ghost">
            Upload file
            <input type="file" accept="image/*" hidden onChange={e => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
          </label>
        </div>
      )}
      {problem ? <p className="login-error" style={{ margin: '8px 0 0' }}>{problem}</p> : null}
    </div>
  )
}

function Amount({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <input className="login-input" inputMode="decimal" placeholder="0.00" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

export function SalesForm({ day, saved }: { day: string; saved: Partial<SalesValues> | null }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(SALES_FIELDS.map(f => [f.key, saved?.[f.key] ? String(saved[f.key]) : ''])) as Record<SalesKey, string>)
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  return (
    <form className="admin-card" onSubmit={e => {
      e.preventDefault()
      const numbers = Object.fromEntries(SALES_FIELDS.map(f => [f.key, Number(values[f.key])])) as SalesValues
      run(async () => setMessage((await saveSales(day, numbers)).message))
    }}>
      <p className="rowlabel">Sales report</p>
      {SALES_FIELDS.map(f => (
        <Amount key={f.key} label={f.label} value={values[f.key]} onChange={v => setValues(s => ({ ...s, [f.key]: v }))} />
      ))}
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>{pending ? 'Saving…' : 'Save sales'}</button>
    </form>
  )
}

export function PurchaseForm({ day, suppliers }: { day: string; suppliers: string[] }) {
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  return (
    <form className="admin-card" onSubmit={e => {
      e.preventDefault()
      if (!photo) return
      run(async () => {
        const form = new FormData()
        form.append('day', day)
        form.append('supplier', supplier)
        form.append('amount', amount)
        form.append('note', note)
        form.append('photo', photo)
        const result = await addPurchase(form)
        setMessage(result.message)
        if (result.ok) {
          setSupplier('')
          setAmount('')
          setNote('')
          setPhoto(null)
        }
      })
    }}>
      <p className="rowlabel">Add a purchase</p>
      <label className="cap" style={{ display: 'block', ...gap }}>
        Supplier
        <input className="login-input" list="report-suppliers" value={supplier} onChange={e => setSupplier(e.target.value)} />
        <datalist id="report-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist>
      </label>
      <Amount label="Amount (RM)" value={amount} onChange={setAmount} />
      <label className="cap" style={{ display: 'block', ...gap }}>
        Note (optional)
        <input className="login-input" value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <InvoicePhoto photo={photo} onChange={setPhoto} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !supplier || !amount || !photo} style={{ marginTop: 12 }}>{pending ? 'Adding…' : 'Add purchase'}</button>
    </form>
  )
}

export function RemovePurchase({ id }: { id: number }) {
  const [pending, run] = useTransition()
  return <button className="btn ghost" type="button" disabled={pending} onClick={() => run(async () => { await removePurchase(id) })}>Remove</button>
}

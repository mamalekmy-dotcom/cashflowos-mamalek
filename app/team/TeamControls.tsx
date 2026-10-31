'use client'
import { useState, useTransition } from 'react'
import { decideOvertime, saveShiftType, saveShopPin, setShift } from './actions'

export function ShiftPicker({ userId, day, value, codes, name }: { userId: number; day: string; value: string; codes: string[]; name: string }) {
  const [pending, start] = useTransition()
  return (
    <select
      className="team-shift"
      aria-label={`${name}, ${day}`}
      defaultValue={value}
      disabled={pending}
      onChange={e => {
        const code = e.target.value
        start(async () => { await setShift(userId, day, code) })
      }}
    >
      <option value="">Off</option>
      {codes.map(code => <option key={code} value={code}>{code}</option>)}
    </select>
  )
}

export function OvertimeButtons({ id }: { id: number }) {
  const [pending, start] = useTransition()
  return (
    <div className="btnrow">
      <button className="btn" type="button" disabled={pending} onClick={() => start(async () => { await decideOvertime(id, true) })}>Approve</button>
      <button className="btn ghost" type="button" disabled={pending} onClick={() => start(async () => { await decideOvertime(id, false) })}>Deny</button>
    </div>
  )
}

export function ShiftForm() {
  const [code, setCode] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('18:00')
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    run(async () => setMessage((await saveShiftType(code, start, end)).message))
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">Add or change a shift</p>
      <input className="login-input" placeholder="Code, e.g. F1" value={code} onChange={e => setCode(e.target.value)} />
      <input className="login-input" type="time" aria-label="Start" value={start} onChange={e => setStart(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" type="time" aria-label="End" value={end} onChange={e => setEnd(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !code} style={{ marginTop: 12 }}>Save shift</button>
    </form>
  )
}

export function PinForm({ saved }: { saved: { lat: number; lng: number; radius: number } | null }) {
  const [lat, setLat] = useState(saved ? String(saved.lat) : '')
  const [lng, setLng] = useState(saved ? String(saved.lng) : '')
  const [radius, setRadius] = useState(String(saved?.radius ?? 100))
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()

  function useHere() {
    navigator.geolocation?.getCurrentPosition(
      p => {
        setLat(String(p.coords.latitude))
        setLng(String(p.coords.longitude))
      },
      () => setMessage('Could not read this device\'s location.'),
      { enableHighAccuracy: true },
    )
  }

  return (
    <div className="admin-card">
      <p className="rowlabel">Shop pin</p>
      <p className="cap" style={{ margin: '0 0 10px' }}>Stand in the shop and tap the button, then save.</p>
      <button className="btn ghost" type="button" onClick={useHere}>Use my location</button>
      <input className="login-input" inputMode="decimal" placeholder="Latitude" value={lat} onChange={e => setLat(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" inputMode="decimal" placeholder="Longitude" value={lng} onChange={e => setLng(e.target.value)} style={{ marginTop: 10 }} />
      <input className="login-input" inputMode="numeric" placeholder="Allowed distance (metres)" value={radius} onChange={e => setRadius(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="button" disabled={pending || !lat || !lng} style={{ marginTop: 12 }} onClick={() => run(async () => setMessage((await saveShopPin(Number(lat), Number(lng), Number(radius))).message))}>Save pin</button>
    </div>
  )
}

export function CopyReport({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button className="btn ghost" type="button" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true) }}>
      {copied ? 'Copied' : 'Copy table for Google Sheets'}
    </button>
  )
}

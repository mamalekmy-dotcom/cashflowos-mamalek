'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { punch } from './actions'

type Kind = 'in' | 'out' | 'break_out' | 'break_in'
type State = 'off' | 'on' | 'break'
type P = { kind: string; punched_at: string }

const HOLD_MS = 700
const GPS_WAIT_MS = 20_000
const GOOD_ACCURACY_M = 100
const PHOTO_WIDTH = 720

// This phone's id, kept in the browser. A new phone (or cleared browser) gets a new id,
// which the server sends to the owner to approve.
function deviceId(): string {
  try {
    let id = localStorage.getItem('ml_device')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('ml_device', id) }
    return id
  } catch { return '' }
}
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (ua.match(/Android [\d.]+; ([^;)]+)/)?.[1] ?? 'Android') : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'phone'
  return os.trim().slice(0, 60)
}

// Waits up to 20 s for a reading within 100 m; keeps the best one seen. Rough Wi-Fi /
// cell guesses are sent with their accuracy, and the server treats them as "no GPS".
function bestPosition(): Promise<GeolocationPosition | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    let best: GeolocationPosition | null = null
    const done = () => { navigator.geolocation.clearWatch(watch); clearTimeout(timer); resolve(best) }
    const watch = navigator.geolocation.watchPosition(p => {
      if (!best || p.coords.accuracy < best.coords.accuracy) best = p
      if (p.coords.accuracy <= GOOD_ACCURACY_M) done()
    }, () => done(), { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_WAIT_MS })
    const timer = setTimeout(done, GPS_WAIT_MS)
  })
}

function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const scale = Math.min(1, PHOTO_WIDTH / width)
  const c = document.createElement('canvas')
  c.width = Math.round(width * scale)
  c.height = Math.round(height * scale)
  c.getContext('2d')?.drawImage(source, 0, 0, c.width, c.height)
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8))
}

// Live camera only, so the photo is taken now. Front camera for the selfie, back for the shop.
function Camera({ facing, label, photo, onChange }: { facing: 'user' | 'environment'; label: string; photo: Blob | null; onChange: (b: Blob | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (photo) return
    let stream: MediaStream | null = null
    let stopped = false
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser has no camera access. Open the app in Chrome or Safari.'); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then(live => { if (stopped) return live.getTracks().forEach(t => t.stop()); stream = live; if (video.current) video.current.srcObject = live })
      .catch(() => setError('Allow camera access for this site, then try again.'))
    return () => { stopped = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [photo, facing])
  const frame = { width: '100%', borderRadius: 14, display: 'block', background: '#000', aspectRatio: '3 / 4', objectFit: 'cover' as const }
  return (
    <div className="cam">
      <p className="rowlabel" style={{ margin: '0 0 6px' }}>{label}</p>
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={URL.createObjectURL(photo)} alt={label} style={frame} />
          <button className="btn ghost" type="button" onClick={() => onChange(null)} style={{ marginTop: 8, width: '100%' }}>Retake</button>
        </>
      ) : error ? <p className="login-error">{error}</p> : (
        <>
          <video ref={video} autoPlay playsInline muted style={{ ...frame, transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />
          <button className="btn" type="button" style={{ marginTop: 8, width: '100%' }} onClick={async () => {
            const v = video.current
            if (v?.videoWidth) onChange(await toJpeg(v, v.videoWidth, v.videoHeight))
          }}>Take photo</button>
        </>
      )}
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
function workedMs(punches: P[], nowMs: number): number {
  let total = 0, from: number | null = null
  for (const p of punches) {
    const t = Date.parse(p.punched_at)
    if (p.kind === 'in' || p.kind === 'break_in') from = t
    else if ((p.kind === 'break_out' || p.kind === 'out') && from !== null) { total += t - from; from = null }
  }
  if (from !== null) total += nowMs - from
  return total
}

export default function PunchDial({ state, since, shiftPunches, breakAllowance }: { state: State; since: string | null; shiftPunches: P[]; breakAllowance: number }) {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  const [holding, setHolding] = useState(false)
  const [sheet, setSheet] = useState<Kind | null>(null)
  const [selfie, setSelfie] = useState<Blob | null>(null)
  const [shop, setShop] = useState<Blob | null>(null)
  const [takenAt, setTakenAt] = useState(0)
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (selfie || shop) setTakenAt(Date.now()) }, [selfie, shop])

  const main: Kind = state === 'off' ? 'in' : state === 'break' ? 'break_in' : 'out'
  const needsProof = (k: Kind) => k === 'in' || k === 'break_in'
  const worked = state === 'off' ? 0 : workedMs(shiftPunches, now)
  const breakMs = state === 'break' && since ? now - Date.parse(since) : 0
  const shown = state === 'break' ? breakMs : worked
  const clock = `${pad(Math.floor(shown / 3_600_000))}:${pad(Math.floor(shown / 60_000) % 60)}:${pad(Math.floor(shown / 1000) % 60)}`
  const overBreak = state === 'break' && breakAllowance > 0 && breakMs > breakAllowance * 60_000

  async function send(kind: Kind) {
    setMessage('')
    start(async () => {
      const form = new FormData()
      form.append('kind', kind)
      form.append('device', deviceId())
      form.append('deviceLabel', deviceLabel())
      if (needsProof(kind)) {
        setStatus('Getting your location (up to 20 s)…')
        const where = await bestPosition()
        if (where) {
          form.append('lat', String(where.coords.latitude))
          form.append('lng', String(where.coords.longitude))
          form.append('accuracy', String(Math.round(where.coords.accuracy)))
        }
        if (selfie) form.append('photo', new File([selfie], 'selfie.jpg', { type: 'image/jpeg' }))
        if (shop) form.append('shopPhoto', new File([shop], 'shop.jpg', { type: 'image/jpeg' }))
        form.append('takenAt', String(takenAt))
      }
      setStatus('Saving…')
      const r = await punch(form)
      setStatus('')
      setMessage(r.message)
      if (r.ok) { setSheet(null); setSelfie(null); setShop(null); router.refresh() }
    })
  }

  function act(kind: Kind) {
    if (needsProof(kind)) { setSheet(kind); setMessage(''); return }
    if (kind === 'out' && !confirm('Clock out now?')) return
    void send(kind)
  }

  const down = () => { setHolding(true); timer.current = setTimeout(() => { setHolding(false); act(main) }, HOLD_MS) }
  const up = () => { setHolding(false); if (timer.current) clearTimeout(timer.current) }

  const title = state === 'off' ? 'Not clocked in' : state === 'break' ? (overBreak ? 'Break is over, come back' : 'On break') : 'On shift'
  const hint = state === 'off' ? 'Hold the dial to clock in' : state === 'break' ? 'Hold the dial to end your break' : 'Hold the dial to clock out'

  return (
    <div className={`dial-card ${state}`}>
      <button type="button" className={`dial${holding ? ' holding' : ''}`} disabled={pending}
        onPointerDown={down} onPointerUp={up} onPointerLeave={up} onContextMenu={e => e.preventDefault()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') act(main) }} aria-label={hint}>
        <svg viewBox="0 0 200 200" className="dial-ring" aria-hidden="true"><circle cx="100" cy="100" r="92" /></svg>
        <span className="dial-time">{clock}</span>
        <span className="dial-sub">{state === 'break' ? `break${breakAllowance ? ` of ${breakAllowance} min` : ''}` : state === 'on' ? 'worked today' : 'hold'}</span>
      </button>
      <p className={`dial-title${overBreak ? ' warn' : ''}`}>{title}</p>
      <p className="cap" style={{ margin: 0, textAlign: 'center' }}>{pending ? status || 'Saving…' : hint}</p>
      {state === 'on' ? <button type="button" className="btn ghost" disabled={pending} style={{ marginTop: 14 }} onClick={() => act('break_out')}>☕ Start break</button> : null}
      {state === 'break' ? <button type="button" className="btn ghost" disabled={pending} style={{ marginTop: 14 }} onClick={() => act('out')}>Clock out instead</button> : null}
      {message ? <p className="cap dial-msg">{message}</p> : null}

      {sheet ? (
        <div className="punch-sheet" role="dialog" aria-label="Photos for clock-in">
          <div className="punch-sheet-body">
            <p className="card-title">{sheet === 'in' ? 'Clock in' : 'Back from break'}: 2 photos</p>
            <p className="cap" style={{ marginTop: 0 }}>A selfie, then a photo of anything inside the shop. Your location is checked when you send.</p>
            <div className="cam-grid">
              <Camera facing="user" label="1. Selfie" photo={selfie} onChange={setSelfie} />
              <Camera facing="environment" label="2. Inside the shop" photo={shop} onChange={setShop} />
            </div>
            {message ? <p className="login-error">{message}</p> : null}
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => { setSheet(null); setSelfie(null); setShop(null) }}>Cancel</button>
              <button type="button" className="btn" disabled={pending || !selfie || !shop} style={{ flex: 1 }} onClick={() => send(sheet)}>
                {pending ? status || 'Saving…' : sheet === 'in' ? 'Clock in' : 'End break'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { punch } from './actions'

const GPS_TIMEOUT_MS = 10000
const SELFIE_WIDTH = 720

function position(): Promise<GeolocationPosition | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS })
  })
}

// Shrinks the picture so a weak shop signal can still upload it.
function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const scale = Math.min(1, SELFIE_WIDTH / width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
}

// Live camera, so the selfie is taken now and can't be picked from the gallery. If the
// browser won't give us the camera, it falls back to the phone's own camera app.
function Selfie({ selfie, onChange }: { selfie: Blob | null; onChange: (photo: Blob | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [noCamera, setNoCamera] = useState(false)
  const preview = selfie ? URL.createObjectURL(selfie) : ''

  useEffect(() => {
    if (selfie) return
    let stream: MediaStream | null = null
    let stopped = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(live => {
        if (stopped) return live.getTracks().forEach(t => t.stop())
        stream = live
        if (video.current) video.current.srcObject = live
      })
      .catch(() => setNoCamera(true))
    if (!navigator.mediaDevices) setNoCamera(true)
    return () => {
      stopped = true
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [selfie])

  async function snap() {
    const v = video.current
    if (v?.videoWidth) onChange(await toJpeg(v, v.videoWidth, v.videoHeight))
  }

  async function picked(file: File | undefined) {
    if (!file) return
    const image = await createImageBitmap(file)
    onChange(await toJpeg(image, image.width, image.height))
  }

  const frame = { width: '100%', maxWidth: 360, borderRadius: 12, display: 'block', background: '#000' }
  if (selfie) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Your selfie" style={frame} />
        <button className="btn ghost" type="button" onClick={() => onChange(null)} style={{ marginTop: 10 }}>Retake</button>
      </>
    )
  }
  if (noCamera) {
    return <input type="file" accept="image/*" capture="user" aria-label="Take a selfie" onChange={e => picked(e.target.files?.[0])} />
  }
  return (
    <>
      <video ref={video} autoPlay playsInline muted style={{ ...frame, transform: 'scaleX(-1)' }} />
      <button className="btn ghost" type="button" onClick={snap} style={{ marginTop: 10 }}>Take selfie</button>
    </>
  )
}

export default function ClockButton({ next }: { next: 'in' | 'out' }) {
  const [selfie, setSelfie] = useState<Blob | null>(null)
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const clockingIn = next === 'in'

  function submit() {
    start(async () => {
      const form = new FormData()
      form.append('kind', next)
      const where = await position()
      if (where) {
        form.append('lat', String(where.coords.latitude))
        form.append('lng', String(where.coords.longitude))
      }
      if (selfie) form.append('photo', new File([selfie], 'selfie.jpg', { type: 'image/jpeg' }))
      const result = await punch(form)
      setMessage(result.message)
      if (result.ok) setSelfie(null)
    })
  }

  return (
    <div className="admin-card">
      {clockingIn ? (
        <>
          <p className="rowlabel">Selfie and location needed to clock in</p>
          <Selfie selfie={selfie} onChange={setSelfie} />
        </>
      ) : null}
      <button className="btn" type="button" disabled={pending || (clockingIn && !selfie)} onClick={submit} style={{ width: '100%', marginTop: 12, padding: 16 }}>
        {pending ? 'Saving…' : clockingIn ? 'Clock in' : 'Clock out'}
      </button>
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
    </div>
  )
}

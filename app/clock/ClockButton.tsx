'use client'
import { useRef, useState, useTransition } from 'react'
import { punch } from './actions'

const GPS_TIMEOUT_MS = 8000

function position(): Promise<GeolocationPosition | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS })
  })
}

export default function ClockButton({ next }: { next: 'in' | 'out' }) {
  const photo = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const form = new FormData()
      form.append('kind', next)
      const where = await position()
      if (where) {
        form.append('lat', String(where.coords.latitude))
        form.append('lng', String(where.coords.longitude))
      }
      const file = photo.current?.files?.[0]
      if (file) form.append('photo', file)
      setMessage((await punch(form)).message)
    })
  }

  return (
    <div className="admin-card">
      <p className="rowlabel">Check-in photo (optional)</p>
      <input ref={photo} type="file" accept="image/*" capture="user" aria-label="Check-in photo" />
      <button className="btn" type="button" disabled={pending} onClick={submit} style={{ width: '100%', marginTop: 12, padding: 16 }}>
        {pending ? 'Saving…' : next === 'in' ? 'Clock in' : 'Clock out'}
      </button>
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
    </div>
  )
}

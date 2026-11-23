'use client'
import { useEffect, useRef, useState } from 'react'
import type { Pt } from './scanner'

// Full-screen check of the 4 corners the scanner found. Staff drag a corner if it's
// off, then tap "Use this". The photo is shown scaled to fit; corners are kept in the
// photo's own pixels.
export default function CropScreen({ photo, corners, found, onDone, onSkip, onCancel, busy }: {
  photo: HTMLCanvasElement; corners: Pt[]; found: boolean
  onDone: (c: Pt[]) => void; onSkip: () => void; onCancel: () => void; busy: boolean
}) {
  const [pts, setPts] = useState(corners)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<number | null>(null)

  useEffect(() => setPts(corners), [corners])
  useEffect(() => {
    const fit = () => {
      const el = wrap.current
      if (!el) return
      const s = Math.min(el.clientWidth / photo.width, el.clientHeight / photo.height)
      setBox({ w: Math.round(photo.width * s), h: Math.round(photo.height * s) })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [photo])
  useEffect(() => {
    const c = canvas.current
    if (!c || !box.w) return
    c.width = box.w
    c.height = box.h
    c.getContext('2d')!.drawImage(photo, 0, 0, box.w, box.h)
  }, [photo, box])

  const k = box.w ? box.w / photo.width : 1
  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !canvas.current) return
    const r = canvas.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(photo.width, (e.clientX - r.left) / k))
    const y = Math.max(0, Math.min(photo.height, (e.clientY - r.top) / k))
    const i = drag.current
    setPts(p => p.map((q, j) => (j === i ? { x, y } : q)))
  }

  return (
    <div className="crop-screen" role="dialog" aria-label="Check the bill's corners">
      <p className="crop-hint">{found ? 'Found the bill. Drag a corner if it’s off.' : 'Drag the 4 corners onto the bill’s edges.'}</p>
      <div className="crop-wrap" ref={wrap}>
        <div className="crop-stage" style={{ width: box.w, height: box.h }} onPointerMove={move} onPointerUp={() => { drag.current = null }}>
          <canvas ref={canvas} />
          <svg width={box.w} height={box.h} className="crop-lines">
            <polygon points={pts.map(p => `${p.x * k},${p.y * k}`).join(' ')} />
          </svg>
          {pts.map((p, i) => (
            <span key={i} className="crop-dot" style={{ left: p.x * k, top: p.y * k }}
              onPointerDown={e => { drag.current = i; (e.target as HTMLElement).setPointerCapture(e.pointerId) }}
              onPointerMove={move} onPointerUp={() => { drag.current = null }} />
          ))}
        </div>
      </div>
      <div className="crop-bar">
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Retake</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onSkip}>Whole photo</button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDone(pts)}>{busy ? 'Scanning…' : 'Use this ✓'}</button>
      </div>
    </div>
  )
}

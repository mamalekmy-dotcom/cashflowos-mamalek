'use client'
import { useEffect, useState } from 'react'

// The AI C Suite map: you at the top, Jarvis Oyen in the middle, the 4 heads around.
// Dots travel up as recommendations (clay) and down as decisions (sage). Speech
// bubbles play one real morning: the head finds something, Jarvis asks you, you say
// YES, the task + draft come back. Styles: .cs-* in globals.css.

type HeadKey = 'finance' | 'marketing' | 'ops' | 'sales'
type Spot = 'you' | 'jarvis' | HeadKey
type Pt = { x: number; y: number }
type Layout = { w: number; h: number; pts: Record<Spot, Pt> }

const WIDE: Layout = {
  w: 760, h: 470,
  pts: { you: { x: 380, y: 56 }, jarvis: { x: 380, y: 262 }, finance: { x: 130, y: 170 }, marketing: { x: 630, y: 170 }, ops: { x: 130, y: 390 }, sales: { x: 630, y: 390 } },
}
const NARROW: Layout = {
  w: 390, h: 600,
  pts: { you: { x: 195, y: 46 }, jarvis: { x: 195, y: 318 }, finance: { x: 78, y: 190 }, marketing: { x: 312, y: 190 }, ops: { x: 78, y: 470 }, sales: { x: 312, y: 470 } },
}

const HEADS: { key: HeadKey; emoji: string; name: string }[] = [
  { key: 'finance', emoji: '💰', name: 'Finance' },
  { key: 'marketing', emoji: '📣', name: 'Marketing' },
  { key: 'ops', emoji: '⚙️', name: 'Ops' },
  { key: 'sales', emoji: '🎯', name: 'Sales' },
]

const R_HEAD = 36
const R_JARVIS = 50

// A soft curve from a head into Jarvis.
const curve = (a: Pt, b: Pt) => `M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`
const line = (a: Pt, b: Pt) => `M ${a.x} ${a.y} L ${b.x} ${b.y}`

type Step = { at: Spot; text: string; tone: 'clay' | 'sage' | 'dim'; hot?: Spot }

export default function CsuiteMap({ findings, live }: { findings: string[]; live: HeadKey[] }) {
  const [narrow, setNarrow] = useState(false)
  const [still, setStill] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const small = window.matchMedia('(max-width: 640px)')
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { setNarrow(small.matches); setStill(calm.matches) }
    sync()
    small.addEventListener('change', sync)
    calm.addEventListener('change', sync)
    return () => { small.removeEventListener('change', sync); calm.removeEventListener('change', sync) }
  }, [])

  const found = findings.length
  const steps: Step[] = [
    ...(found
      ? findings.slice(0, 2).map((f): Step => ({ at: 'finance', text: f, tone: 'clay', hot: 'finance' }))
      : [{ at: 'finance', text: 'All lines OK today ✓', tone: 'sage', hot: 'finance' } as Step]),
    { at: 'jarvis', text: found ? 'Boss, 1 thing needs your YES' : 'Nothing needs you today', tone: 'clay', hot: 'you' },
    ...(found
      ? [
          { at: 'you', text: '✅ Approve', tone: 'sage', hot: 'you' } as Step,
          { at: 'jarvis', text: 'Task added · draft ready', tone: 'sage', hot: 'finance' } as Step,
        ]
      : []),
    { at: 'ops', text: 'Standing by · needs data', tone: 'dim' },
    { at: 'marketing', text: 'Coming next', tone: 'dim' },
  ]

  useEffect(() => {
    if (still) return
    const t = setInterval(() => setStep(s => (s + 1) % steps.length), 3000)
    return () => clearInterval(t)
  }, [still, steps.length])

  const L = narrow ? NARROW : WIDE
  const P = L.pts
  const now = steps[step % steps.length]
  const fs = narrow ? 14 : 13

  // Bubble above a node (below YOU), kept inside the picture.
  const bubble = (s: Step) => {
    const w = Math.round(s.text.length * fs * 0.56 + 26)
    const h = 30
    const p = P[s.at]
    const r = s.at === 'jarvis' ? R_JARVIS : s.at === 'you' ? 22 : R_HEAD
    const y = s.at === 'you' ? p.y + 30 : p.y - r - h - 12
    const x = Math.min(Math.max(p.x - w / 2, 6), L.w - w - 6)
    return { x, y, w, h }
  }
  const b = bubble(now)

  const dots = (d: string, n: number, dur: number, up: boolean, cls: string) =>
    still ? null : Array.from({ length: n }, (_, i) => (
      <circle key={`${cls}${i}`} r={up ? 4 : 3.5} className={cls}>
        <animateMotion dur={`${dur}s`} begin={`${(i * dur) / n}s`} repeatCount="indefinite" path={d}
          keyPoints={up ? '0;1' : '1;0'} keyTimes="0;1" calcMode="linear" />
      </circle>
    ))

  return (
    <div className="cs-stage">
      <svg viewBox={`0 0 ${L.w} ${L.h}`} className={`cs-svg${narrow ? ' narrow' : ''}`} role="img"
        aria-label={`Jarvis Oyen links you to 4 AI heads. Live: ${live.join(', ')}. ${found ? `Finance found: ${findings.join('; ')}` : 'Finance: all lines OK.'}`}>
        {/* The links. */}
        <path d={line(P.you, P.jarvis)} className={`cs-link live${now.hot === 'you' ? ' hot' : ''}`} />
        {HEADS.map(h => (
          <path key={h.key} d={curve(P[h.key], P.jarvis)}
            className={`cs-link${live.includes(h.key) ? ' live' : ''}${now.hot === h.key ? ' hot' : ''}`} />
        ))}

        {/* Traffic: recommendations up, decisions down. */}
        {dots(line(P.jarvis, P.you), 2, 3.2, true, 'cs-dot up')}
        {dots(line(P.jarvis, P.you), 1, 3.2, false, 'cs-dot down')}
        {HEADS.map(h => live.includes(h.key)
          ? <g key={h.key}>{dots(curve(P[h.key], P.jarvis), 3, 3.6, true, 'cs-dot up')}{dots(curve(P[h.key], P.jarvis), 2, 3.6, false, 'cs-dot down')}</g>
          : <g key={h.key}>{dots(curve(P[h.key], P.jarvis), 1, 7, true, 'cs-dot idle')}</g>)}

        {/* You, the CEO. */}
        <g>
          <rect x={P.you.x - 78} y={P.you.y - 22} width={156} height={44} rx={22} className="cs-you" />
          <text x={P.you.x} y={P.you.y + 1} className="cs-you-t">👤 YOU · CEO</text>
        </g>

        {/* Jarvis Oyen. */}
        <g>
          {!still && <circle cx={P.jarvis.x} cy={P.jarvis.y} r={R_JARVIS} className="cs-ring jarvis" />}
          <circle cx={P.jarvis.x} cy={P.jarvis.y} r={R_JARVIS} className="cs-jarvis" />
          <text x={P.jarvis.x} y={P.jarvis.y + 2} className="cs-emoji big">🐱</text>
          <text x={P.jarvis.x} y={P.jarvis.y + R_JARVIS + 20} className="cs-name">Jarvis Oyen</text>
          <text x={P.jarvis.x} y={P.jarvis.y + R_JARVIS + 36} className="cs-sub">chief of staff</text>
        </g>

        {/* The heads. */}
        {HEADS.map(h => {
          const p = P[h.key]
          const on = live.includes(h.key)
          return (
            <g key={h.key} className={on ? '' : 'cs-off'}>
              {on && !still && <circle cx={p.x} cy={p.y} r={R_HEAD} className="cs-ring" />}
              <circle cx={p.x} cy={p.y} r={R_HEAD} className={`cs-head${on ? ' on' : ''}`} />
              <text x={p.x} y={p.y + 2} className="cs-emoji">{h.emoji}</text>
              <text x={p.x} y={p.y + R_HEAD + 19} className="cs-name">Head of {h.name}</text>
              <text x={p.x} y={p.y + R_HEAD + 35} className={`cs-sub${on ? ' live' : ''}`}>{on ? '● Live' : '○ Coming next'}</text>
            </g>
          )
        })}

        {/* The speech bubble for this beat. */}
        <g transform={`translate(${b.x} ${b.y})`}>
          <g key={step} className={`cs-bubble ${now.tone}`}>
            <rect width={b.w} height={b.h} rx={15} />
            <text x={b.w / 2} y={b.h / 2 + 1} style={{ fontSize: fs }}>{now.text}</text>
          </g>
        </g>
      </svg>
      <p className="cs-legend">
        <span><i className="cs-key up" /> recommendation up</span>
        <span><i className="cs-key down" /> your decision down</span>
        <span>Nothing reaches a customer, supplier or staff member without your YES.</span>
      </p>
    </div>
  )
}

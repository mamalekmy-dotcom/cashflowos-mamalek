'use client'
import { useState } from 'react'

export type Slice = { key: string; label: string; amount: number; color: string; percent: string; money: string }

// Each slice's size is its share of nett sales, so the biggest cost has the biggest
// slice. Point at a slice (or tap it on a phone) and the middle shows that slice.
export default function Doughnut({ slices, flr, sales, warn }: { slices: Slice[]; flr: string; sales: string; warn: boolean }) {
  const [active, setActive] = useState<string | null>(null)
  const r = 80
  const around = 2 * Math.PI * r
  const total = slices.reduce((s, x) => s + x.amount, 0)
  const picked = slices.find(s => s.key === active)
  let start = 0
  return (
    <svg viewBox="0 0 220 220" width="100%" style={{ maxWidth: 280, display: 'block', margin: '0 auto' }} role="img" aria-label={`FLR ${flr}`}>
      <circle cx="110" cy="110" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="28" />
      {total > 0 && slices.map(s => {
        const len = (s.amount / total) * around
        const arc = (
          <circle key={s.key} cx="110" cy="110" r={r} fill="none" stroke={s.color} strokeWidth={active === s.key ? 34 : 28}
            strokeDasharray={`${len} ${around - len}`} strokeDashoffset={-start} transform="rotate(-90 110 110)"
            style={{ cursor: 'pointer', transition: 'stroke-width .15s' }}
            onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}
            onClick={() => setActive(a => (a === s.key ? null : s.key))}>
            <title>{`${s.label}: ${s.percent} (${s.money})`}</title>
          </circle>
        )
        start += len
        return arc
      })}
      <text x="110" y="96" textAnchor="middle" fontSize="11" fill={picked ? picked.color : 'var(--ink-soft)'} letterSpacing="1">
        {picked ? picked.label.toUpperCase() : 'FLR'}
      </text>
      <text x="110" y="124" textAnchor="middle" fontSize="30" fontWeight="700" fill={!picked && warn ? 'var(--rust)' : 'var(--ink)'}>
        {picked ? picked.percent : flr}
      </text>
      <text x="110" y="142" textAnchor="middle" fontSize="9" fill="var(--ink-soft)">{picked ? picked.money : 'of nett sales'}</text>
      {picked ? null : <text x="110" y="155" textAnchor="middle" fontSize="9" fill="var(--ink-soft)">{sales}</text>}
    </svg>
  )
}

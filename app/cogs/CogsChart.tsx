'use client'
import { useState } from 'react'

export type ChartMonth = { month: string; label: string; sales: number; cogs: number | null; percent: number | null }

const W = 760, H = 320
const PAD = { left: 64, right: 48, top: 20, bottom: 40 }
const SALES = 'var(--f-views)'
const COGS = 'var(--clay)'
const LINE = 'var(--rust)'
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`
const nice = (n: number) => {
  const step = 10 ** Math.floor(Math.log10(n || 1))
  return Math.ceil(n / step) * step
}

// Nett sales and COGS bars for each month, with COGS % as a line on the right-hand
// scale. Point at a month (or tap it) to see its numbers.
export default function CogsChart({ months }: { months: ChartMonth[] }) {
  const [active, setActive] = useState<number | null>(null)
  const top = nice(Math.max(1, ...months.map(m => Math.max(m.sales, m.cogs ?? 0))))
  const topPct = Math.max(50, nice(Math.max(0, ...months.map(m => m.percent ?? 0))))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / months.length
  const bar = Math.min(22, slot * 0.32)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const yPct = (p: number) => PAD.top + plotH - (p / topPct) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const points = months.map((m, i) => (m.percent == null ? null : { x: PAD.left + slot * (i + 0.5), y: yPct(m.percent) }))
  const line = points.reduce((d, p, i) => (p ? `${d}${d && points[i - 1] ? ' L' : ' M'}${p.x},${p.y}` : d), '')
  const picked = active == null ? null : months[active]

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
        <span><Key color={SALES} /> Nett sales</span>
        <span><Key color={COGS} /> COGS</span>
        <span><Key color={LINE} line /> COGS % of nett sales</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Nett sales and COGS by month" onMouseLeave={() => setActive(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(top * t)} y2={y(top * t)} stroke="var(--line)" />
            <text x={PAD.left - 8} y={y(top * t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--ink-soft)">{(top * t / 1000).toFixed(0)}k</text>
            <text x={W - PAD.right + 8} y={yPct(topPct * t)} dominantBaseline="middle" fontSize="11" fill={LINE}>{Math.round(topPct * t)}%</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = PAD.left + slot * (i + 0.5)
          return (
            <g key={m.month} onMouseEnter={() => setActive(i)} onClick={() => setActive(a => (a === i ? null : i))} style={{ cursor: 'pointer' }}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill={active === i ? 'var(--paper-2)' : 'transparent'} />
              {m.sales > 0 && <rect x={x - bar - 1} y={y(m.sales)} width={bar} height={y(0) - y(m.sales)} rx="3" fill={SALES} />}
              {m.cogs != null && m.cogs > 0 && <rect x={x + 1} y={y(m.cogs)} width={bar} height={y(0) - y(m.cogs)} rx="3" fill={COGS} />}
              <text x={x} y={H - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="var(--ink-soft)">{m.label}</text>
            </g>
          )
        })}
        <path d={line} fill="none" stroke={LINE} strokeWidth="2" pointerEvents="none" />
        {points.map((p, i) => p && (
          <circle key={i} cx={p.x} cy={p.y} r={active === i ? 5 : 3.5} fill="var(--card)" stroke={LINE} strokeWidth="2" pointerEvents="none" />
        ))}
      </svg>
      {picked ? (
        <div className="admin-card" style={{ position: 'absolute', top: 30, right: 0, padding: '10px 14px', fontSize: 13, minWidth: 180, pointerEvents: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.08)' }}>
          <strong>{picked.label} {picked.month.slice(0, 4)}</strong>
          <div>Nett sales: {picked.sales ? rm(picked.sales) : 'none'}</div>
          <div>COGS: {picked.cogs == null ? 'waiting for closing count' : rm(picked.cogs)}</div>
          <div>COGS %: {picked.percent == null ? '–' : `${picked.percent.toFixed(1)}%`}</div>
        </div>
      ) : null}
    </div>
  )
}

function Key({ color, line }: { color: string; line?: boolean }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: line ? 3 : 10, borderRadius: 2, background: color, marginRight: 4, verticalAlign: 'middle' }} />
}

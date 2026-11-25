// Small SVG charts for the homepage, drawn on the server. Hover a point or bar for its
// exact value (a <title> on each). Colours come from the theme variables.

const W = 640
const H = 240
const PAD = { l: 44, r: 12, t: 14, b: 30 }
const iw = W - PAD.l - PAD.r
const ih = H - PAD.t - PAD.b

const kfmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))
const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Grid({ max, ticks, fmt }: { max: number; ticks: number; fmt: (n: number) => string }) {
  return (
    <>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i
        const y = PAD.t + ih - (v / max) * ih
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="ch-grid" />
            <text x={PAD.l - 6} y={y + 4} className="ch-axis" textAnchor="end">{fmt(v)}</text>
          </g>
        )
      })}
    </>
  )
}

export function FoodCostLine({ points, target }: { points: { label: string; value: number | null; estimate: boolean }[]; target: number }) {
  const vals = points.map(p => p.value ?? 0)
  const max = Math.max(40, Math.ceil((Math.max(...vals, target) + 5) / 10) * 10)
  const step = points.length > 1 ? iw / (points.length - 1) : 0
  const xy = (i: number, v: number) => [PAD.l + i * step, PAD.t + ih - (v / max) * ih] as const
  const real = points.map((p, i) => (p.value != null ? xy(i, p.value) : null))
  const path = real.reduce((s, p, i) => (p ? `${s}${s && real[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : s), '')
  const ty = PAD.t + ih - (target / max) * ih
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Food cost percent by month">
      <Grid max={max} ticks={4} fmt={n => `${Math.round(n)}%`} />
      <line x1={PAD.l} x2={W - PAD.r} y1={ty} y2={ty} className="ch-target" />
      <text x={W - PAD.r} y={ty - 5} className="ch-axis" textAnchor="end">target {target}%</text>
      <path d={path} className="ch-line" />
      {points.map((p, i) => {
        if (p.value == null) return null
        const [x, y] = xy(i, p.value)
        return (
          <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 6 : 4.5} className={p.estimate ? 'ch-dot est' : 'ch-dot'}>
            <title>{`${p.label}: ${p.value.toFixed(1)}%${p.estimate ? ' (estimate)' : ''}`}</title>
          </circle>
        )
      })}
      {points.map((p, i) => <text key={i} x={xy(i, 0)[0]} y={H - 8} className="ch-axis" textAnchor="middle">{p.label}</text>)}
    </svg>
  )
}

export function SalesCogsBars({ items }: { items: { label: string; sales: number; cogs: number; estimate: boolean }[] }) {
  const max = Math.max(1, ...items.map(i => i.sales)) * 1.1
  const slot = iw / Math.max(1, items.length)
  const bw = Math.min(26, slot / 3)
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Nett sales and cost of goods by month">
      <Grid max={max} ticks={3} fmt={kfmt} />
      {items.map((it, i) => {
        const cx = PAD.l + slot * i + slot / 2
        return (
          <g key={i}>
            <rect x={cx - bw - 2} y={y(it.sales)} width={bw} height={PAD.t + ih - y(it.sales)} rx={3} className="ch-bar-soft">
              <title>{`${it.label} nett sales: ${money(it.sales)}`}</title>
            </rect>
            <rect x={cx + 2} y={y(it.cogs)} width={bw} height={PAD.t + ih - y(it.cogs)} rx={3} className={it.estimate ? 'ch-bar est' : 'ch-bar'}>
              <title>{`${it.label} COGS: ${money(it.cogs)}${it.estimate ? ' (estimate)' : ''}`}</title>
            </rect>
            <text x={cx} y={H - 8} className="ch-axis" textAnchor="middle">{it.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function DailyBars({ items, today }: { items: { date: string; nett: number }[]; today: string }) {
  const max = Math.max(1, ...items.map(i => i.nett)) * 1.1
  const avg = items.length ? items.reduce((s, i) => s + i.nett, 0) / items.length : 0
  const slot = iw / Math.max(1, items.length)
  const bw = Math.max(4, Math.min(18, slot * 0.6))
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  const ay = y(avg)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Nett sales by day this month">
      <Grid max={max} ticks={3} fmt={kfmt} />
      <line x1={PAD.l} x2={W - PAD.r} y1={ay} y2={ay} className="ch-target" />
      <text x={W - PAD.r} y={ay - 5} className="ch-axis" textAnchor="end">avg {kfmt(avg)}</text>
      {items.map((it, i) => {
        const cx = PAD.l + slot * i + slot / 2
        const low = it.nett < avg * 0.75
        const day = Number(it.date.slice(8, 10))
        return (
          <g key={it.date}>
            <rect x={cx - bw / 2} y={y(it.nett)} width={bw} height={PAD.t + ih - y(it.nett)} rx={2}
              className={it.date === today ? 'ch-bar est' : low ? 'ch-bar low' : 'ch-bar'}>
              <title>{`${it.date}: ${money(it.nett)}${it.date === today ? ' (so far today)' : ''}`}</title>
            </rect>
            {items.length <= 16 || day % 5 === 0 || day === 1 ? <text x={cx} y={H - 8} className="ch-axis" textAnchor="middle">{day}</text> : null}
          </g>
        )
      })}
    </svg>
  )
}

export function SupplierBars({ items }: { items: { supplier: string; now: number; before: number }[] }) {
  if (!items.length) return <p className="cap">No purchases recorded this month yet.</p>
  const max = Math.max(1, ...items.flatMap(i => [i.now, i.before]))
  return (
    <div className="sup-list">
      {items.map(s => {
        const change = s.before ? Math.round(((s.now - s.before) / s.before) * 100) : null
        return (
          <div key={s.supplier} className="sup-row">
            <div className="sup-top">
              <span className="sup-name">{s.supplier}</span>
              <span className="sup-amt">{money(s.now)}{change !== null ? <em className={change > 0 ? 'up' : 'down'}> {change > 0 ? '▲' : '▼'} {Math.abs(change)}%</em> : null}</span>
            </div>
            <div className="sup-track" title={`Last month by the same day: ${money(s.before)}`}>
              <span className="sup-before" style={{ width: `${(s.before / max) * 100}%` }} />
              <span className="sup-now" style={{ width: `${(s.now / max) * 100}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

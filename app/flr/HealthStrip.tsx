import Link from 'next/link'
import { FLR_LIMIT, flrHealth } from '@/lib/flr'

const WORDS = {
  healthy: { title: 'Healthy', note: `under ${FLR_LIMIT}%` },
  border: { title: 'On the border', note: `exactly ${FLR_LIMIT}%` },
  unhealthy: { title: 'Unhealthy', note: `over ${FLR_LIMIT}%` },
}

// Green under 70%, amber at exactly 70%, red over. Used on the FLR Report and the Dashboard.
export default function HealthStrip({ percent, label, href }: { percent: number | null; label?: string; href?: string }) {
  if (percent === null) return <p className="cap">No sales yet, so no FLR.</p>
  const health = flrHealth(percent)
  const strip = (
    <div className={`flr-strip ${health}`} role="status">
      <strong>{WORDS[health].title}</strong>
      <span>{label ? `${label} · ` : ''}FLR {percent.toFixed(1)}%, {WORDS[health].note}</span>
    </div>
  )
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{strip}</Link> : strip
}

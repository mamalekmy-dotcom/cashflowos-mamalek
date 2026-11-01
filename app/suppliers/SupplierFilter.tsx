'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Picking a date reloads the page straight away, with no button to press.
export default function SupplierFilter({ month, day, year }: { month: string; day: string; year: string }) {
  const router = useRouter()
  const label = { display: 'block', flex: '1 1 180px', maxWidth: 240 }

  return (
    <div className="btnrow" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
      <label className="cap" style={label}>
        Month
        <input
          className="login-input"
          type="month"
          value={month}
          onChange={e => { if (e.target.value) router.push(`/suppliers?month=${e.target.value}`) }}
        />
      </label>
      <label className="cap" style={label}>
        Day
        <input
          className="login-input"
          type="date"
          value={day}
          onChange={e => { if (e.target.value) router.push(`/suppliers?day=${e.target.value}`) }}
        />
      </label>
      <Link className="btn ghost" href="/suppliers?all=1">Whole of {year}</Link>
    </div>
  )
}

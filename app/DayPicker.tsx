'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

// Today / Yesterday / a calendar date for one Dashboard section. The day sits in the URL
// (?sales=, ?flr=, ?costs=) so each section keeps its own; today leaves it out.
export default function DayPicker({ param, day, today, yesterday }: { param: string; day: string; today: string; yesterday: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, start] = useTransition()

  const go = (next: string) => {
    if (!next || next === day) return
    const q = new URLSearchParams(params.toString())
    if (next === today) q.delete(param)
    else q.set(param, next)
    const qs = q.toString()
    start(() => router.push(qs ? `/?${qs}` : '/', { scroll: false }))
  }

  return (
    <div className="daypick" aria-busy={pending}>
      <button type="button" className={`btn ghost${day === today ? ' on' : ''}`} onClick={() => go(today)} disabled={pending}>Today</button>
      <button type="button" className={`btn ghost${day === yesterday ? ' on' : ''}`} onClick={() => go(yesterday)} disabled={pending}>Yesterday</button>
      <input type="date" aria-label="Pick a date" value={day} max={today} min="2026-01-01" disabled={pending}
        onChange={e => go(e.target.value)} />
      {pending ? <span className="cap">Loading…</span> : null}
    </div>
  )
}

'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import MoreSheet, { type MoreTab } from './MoreSheet'
import { accessLevel, type AccessUser } from '@/lib/access'

// 👉 The phone bottom bar (shown ≤768px). Four thumb-size primary tabs + a
//    "More" button that opens the slide-up sheet with everything else, so all
//    10 sections stay reachable on a phone. Keep this in sync with Nav.tsx.
const TABS: MoreTab[] = [
  { href: '/', label: 'Dashboard', ico: '🏠' },
  { href: '/pulse', label: 'P&L Pulse', ico: '📈' },
  { href: '/cash-in', label: 'Cash In', ico: '💰' },
  { href: '/cash-out', label: 'Cash Out', ico: '🧾' },
  { href: '/approvals', label: 'Approvals', ico: '🙋' },
  { href: '/leads', label: 'Leads', ico: '🧲' },
  { href: '/customers', label: 'Customers', ico: '🧑‍🤝‍🧑' },
  { href: '/content', label: 'Content', ico: '📣' },
  { href: '/tasks', label: 'Tasks', ico: '✅' },
  { href: '/employees', label: 'AI Employees', ico: '🤖' },
  { href: '/vault', label: 'Vault', ico: '🗄️' },
  { href: '/chat', label: 'Chat', ico: '💬' },
  { href: '/clock', label: 'Clock in', ico: '⏰' },
  { href: '/team', label: 'Talent HQ', ico: '👥' },
  { href: '/suppliers', label: 'Suppliers', ico: '🚚' },
  { href: '/scan', label: 'Scan', ico: '📷' },
  { href: '/docs', label: 'Doc Center', ico: '📁' },
  { href: '/reviews', label: 'Table QR', ico: '⭐' },
  { href: '/memory', label: 'Outlet Memory', ico: '🧠' },
  { href: '/admin', label: 'Admin', ico: '🛠️' },
  { href: '/account', label: 'My account', ico: '👤' },
]

// The first 4 tabs this person can reach sit on the bar, and the rest go in More.
const BAR_SIZE = 4

export default function BottomNav({ user }: { user: AccessUser }) {
  const path = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const visible = TABS.filter(t => accessLevel(user, t.href))
  const primary = visible.slice(0, BAR_SIZE)
  const more = visible.slice(BAR_SIZE)
  const moreActive = more.some(t => t.href === path)
  return (
    <>
      <nav className="bottomnav">
        {primary.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className={path === t.href ? 'active' : ''}
            onClick={() => setMoreOpen(false)}
          >
            <span className="ico" aria-hidden="true">{t.ico}</span>
            {t.label}
          </Link>
        ))}
        {more.length > 0 ? (
          <button
            type="button"
            className={`bn-more${moreActive ? ' active' : ''}`}
            onClick={() => setMoreOpen(v => !v)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <span className="ico" aria-hidden="true">⋯</span>
            More
          </button>
        ) : null}
      </nav>
      <MoreSheet tabs={more} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}

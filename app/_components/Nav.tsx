'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { showsTab, type AccessUser } from '@/lib/access'

// 👉 The desktop sidebar tabs, grouped under micro-cap section labels.
//    Adding a tab? Add ONE line to the right group here, add the SAME tab to
//    BottomNav.tsx (so it shows on phones too), say who can reach it in
//    lib/access.ts (until you do, it's owners only), and create app/<name>/page.tsx.
//    See docs/add-a-tab-prompt.md for the copy-paste prompt that does all three.
export const NAV_GROUPS: { label: string; tabs: { href: string; label: string }[] }[] = [
  { label: 'Overview', tabs: [
    { href: '/', label: 'Dashboard' },
    { href: '/report', label: 'Daily Report' },
  ] },
  { label: 'Work', tabs: [
    { href: '/content', label: 'Content' },
    { href: '/tasks', label: 'Tasks' },
  ] },
  { label: 'Robot', tabs: [
    { href: '/approvals', label: 'Approvals' },
    { href: '/employees', label: 'AI Employees' },
    { href: '/vault', label: 'Vault' },
  ] },
  { label: 'People', tabs: [
    { href: '/hr/people', label: 'Staff' },
    { href: '/clock', label: 'Clock in' },
    { href: '/team/history', label: 'Clock history' },
    { href: '/hr/leave', label: 'Leave approvals' },
    { href: '/team', label: 'Talent HQ' },
    { href: '/chat', label: 'Chat' },
    { href: '/hr', label: 'HR' },
  ] },
  { label: 'Purchasing', tabs: [
    { href: '/suppliers', label: 'Suppliers' },
    { href: '/stock', label: 'Stock' },
    { href: '/scan', label: 'Scan' },
    { href: '/docs', label: 'Doc Center' },
  ] },
  { label: 'Account', tabs: [
    { href: '/admin', label: 'Admin' },
    { href: '/account', label: 'My account' },
  ] },
]

// Flat list kept for anything that wants every tab in one array.
export const TABS = NAV_GROUPS.flatMap(g => g.tabs)

// `pendingCount` is an optional seam: pass it (from a server component that
// already knows the number) to show the clay 🙋 badge on Approvals. We never
// fetch here — a client nav must stay free of its own server round-trips.
// Only tabs this person can reach are listed. That's tidiness: proxy.ts does the blocking.
export default function Nav({ pendingCount, user }: { pendingCount?: number; user: AccessUser }) {
  const path = usePathname()
  const groups = NAV_GROUPS
    .map(group => ({ ...group, tabs: group.tabs.filter(t => showsTab(user, t.href)) }))
    .filter(group => group.tabs.length > 0)
  return (
    <nav className="nav">
      {groups.map(group => (
        <div className="nav-group" key={group.label}>
          <p className="nav-label">{group.label}</p>
          {group.tabs.map(t => (
            <Link key={t.href} href={t.href} className={path === t.href ? 'active' : ''}>
              <span>{t.label}</span>
              {t.href === '/approvals' && pendingCount ? (
                <span className="nav-badge" aria-label={`${pendingCount} pending`}>{pendingCount}</span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}

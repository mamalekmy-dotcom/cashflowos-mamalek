// 👉 Who can reach which tab. Adding a tab? Add it to ROLE_ACCESS for the roles that
// need it, and to GRANTABLE_TABS so an admin can tick it for one person. A tab left
// out stays owners only: proxy.ts denies anything this file doesn't allow.
// No server imports here, so the nav and the admin panel can use it in the browser.

export const ROLES = [
  { key: 'owner', label: 'Owner' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'sales', label: 'Sales' },
  { key: 'ops', label: 'Ops/Stock' },
  { key: 'staff', label: 'Staff' },
] as const

export type Role = (typeof ROLES)[number]['key']
export type Level = 'edit' | 'view'
export type AccessUser = { role: string; extra_tabs: string[] }

const ROLE_ACCESS: Record<Exclude<Role, 'owner'>, Record<string, Level>> = {
  marketing: {
    '/marketing': 'edit',
    '/content': 'edit',
    '/crm': 'view',
    '/leads': 'view',
    '/customers': 'view',
    '/tasks': 'edit',
  },
  sales: { '/crm': 'edit', '/leads': 'edit', '/customers': 'edit', '/tasks': 'edit' },
  ops: { '/suppliers': 'edit', '/stock': 'edit', '/vault': 'edit', '/tasks': 'edit' },
  staff: { '/tasks': 'edit' },
}

// Tabs an admin can tick for one person on top of their role. Admin is left out
// on purpose: only the Owner role reaches the admin panel.
export const GRANTABLE_TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/pulse', label: 'P&L Pulse' },
  { href: '/cash-in', label: 'Cash In' },
  { href: '/cash-out', label: 'Cash Out' },
  { href: '/content', label: 'Content' },
  { href: '/leads', label: 'Leads' },
  { href: '/customers', label: 'Customers' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/employees', label: 'AI Employees' },
  { href: '/vault', label: 'Vault' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/stock', label: 'Stock' },
  // Module tabs still being built. They sit last so nobody lands on a page that
  // doesn't exist yet. Move each one up when its tab is merged.
  { href: '/marketing', label: 'Marketing' },
  { href: '/crm', label: 'CRM' },
]

// Pages every logged-in person gets, whatever their role.
// /me and /hr are open to everyone because lib/hr/guard.ts decides record by
// record who sees what there.
const EVERYONE = ['/account', '/scan', '/clock', '/chat', '/tasks', '/me', '/hr']

// The first part of a path, so /leads/123 follows the rule for /leads.
const tabOf = (path: string) => '/' + (path.split('/')[1] ?? '')

export function accessLevel(user: AccessUser, path: string): Level | null {
  if (user.role === 'owner') return 'edit'
  const tab = tabOf(path)
  if (EVERYONE.includes(tab)) return 'edit'
  if (user.extra_tabs.includes(tab)) return 'edit'
  return ROLE_ACCESS[user.role as keyof typeof ROLE_ACCESS]?.[tab] ?? null
}

// Links for owners only. The HR pages stay open to supervisors through the HR tab, so
// this hides the shortcut from the menu rather than blocking the page.
const OWNER_LINKS = ['/hr/leave', '/hr/people']
// Tabs owners don't want in their menu. The pages still work: /me is how staff apply
// for leave, sales needs Leads, the dashboard links to /pulse, and guest QR pages use /r.
const HIDDEN_FROM_OWNERS = ['/pulse', '/cash-in', '/cash-out', '/leads', '/customers', '/me', '/reviews', '/memory']
export const showsTab = (user: AccessUser, href: string) => {
  if (!accessLevel(user, href)) return false
  return user.role === 'owner' ? !HIDDEN_FROM_OWNERS.includes(href) : !OWNER_LINKS.includes(href)
}

// Where someone lands after login: staff go straight to clock in, everyone else to
// the Dashboard if they have it, otherwise their first tab. /account always works, so
// nobody ends up on a dead page.
export function homeFor(user: AccessUser): string {
  if (user.role === 'staff') return '/clock'
  const first = GRANTABLE_TABS.find(t => accessLevel(user, t.href))
  return first ? first.href : '/account'
}

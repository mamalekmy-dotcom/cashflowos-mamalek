import { NextResponse, type NextRequest } from 'next/server'
import { accessLevel, homeFor } from '@/lib/access'
import { SESSION_COOKIE, userForToken } from '@/lib/session'

// 🔒 Don't edit — this keeps your robot safe.
// The one gate in front of every page and server action. In Next 16 this file is
// called `proxy.ts` (the old name `middleware.ts` is deprecated).
//
// It denies by default: no valid session means /login, and a page lib/access.ts
// doesn't allow for this person sends them to their own home page. Hiding a tab in
// the menu is only cosmetic; this is what actually keeps people out.
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const user = token ? await userForToken(token) : null
  const path = req.nextUrl.pathname

  const redirect = (to: string) => {
    const url = req.nextUrl.clone()
    url.pathname = to
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (!user) return redirect('/login')
  if (user.must_change_password && path !== '/account') return redirect('/account')

  const level = accessLevel(user, path)
  if (!level) return redirect(homeFor(user))
  // View-only people can read a page, but its server actions (POSTs) are refused.
  if (level === 'view' && req.method !== 'GET' && req.method !== 'HEAD') {
    return new NextResponse('View only', { status: 403 })
  }
  return NextResponse.next()
}

// The matcher protects every page EXCEPT the ones below, which must stay reachable
// without a session:
//   • /login, /forgot-password, /reset-password, /api/login, /api/logout,
//     /api/password/* — you can't log in through a locked login page
//   • /r/*                    — guest review pages from table QR codes (no login)
//   • /api/telegram           — Telegram's webhook (has its own secret-header guard)
//   • /api/cron-daily         — the daily cron (has its own fail-closed Bearer guard)
//   • /manifest.webmanifest   — the REAL PWA manifest (app/manifest.ts serves HERE);
//     /manifest.json          — belt-and-braces extra so install never silently breaks
//   • /icons/*, /favicon.ico, /_next/* — static assets the install/render needs
// A single missed exclusion here = a locked webhook on class day, so this list is tested.
export const config = {
  matcher: [
    '/((?!login|r/|forgot-password|reset-password|api/login|api/logout|api/password|api/telegram|api/cron-daily|manifest\\.webmanifest|manifest\\.json|icons|_next|favicon\\.ico).*)',
  ],
}

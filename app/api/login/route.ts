import { NextResponse } from 'next/server'
import { homeFor } from '@/lib/access'
import { SESSION_COOKIE, SESSION_DAYS, createSession, emailForStaffId, passwordMatches, userByEmail } from '@/lib/session'

// 🔒 Don't edit — this keeps your robot safe.
// Email or staff ID + password login. Every failure gives the same answer, so this
// page can't be used to find out which emails or IDs have accounts.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const login = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const refused = NextResponse.json({ ok: false }, { status: 401 })
  if (!login || !password) return refused

  const email = login.includes('@') ? login : await emailForStaffId(login)
  if (!email) return refused

  const user = await userByEmail(email)
  if (!user?.active || !(await passwordMatches(email, password))) return refused

  const token = await createSession(user.id)
  const res = NextResponse.json({ ok: true, home: user.must_change_password ? '/account' : homeFor(user) })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  })
  return res
}

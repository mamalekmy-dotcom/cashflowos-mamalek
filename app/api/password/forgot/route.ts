import { NextResponse } from 'next/server'
import { freshAuthClient } from '@/lib/supabase'
import { userByEmail } from '@/lib/session'

// Sends a reset link to active accounts. It answers the same either way, so nobody
// can use it to check whether an email has an account.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const user = email ? await userByEmail(email) : null
  if (user?.active) {
    const { error } = await freshAuthClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${new URL(req.url).origin}/reset-password`,
    })
    if (error) console.error('[CFO] reset email failed:', error.message)
  }
  return NextResponse.json({ ok: true })
}

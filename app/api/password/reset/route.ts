import { NextResponse } from 'next/server'
import { freshAuthClient, supabase } from '@/lib/supabase'
import { endAllSessions, userByEmail } from '@/lib/session'

// Finishes a reset from the emailed link. The link's token proves who this is; the
// password then changes and every device of theirs is logged out.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 10) {
    return NextResponse.json({ ok: false, message: 'Use at least 10 characters.' }, { status: 400 })
  }
  const expired = NextResponse.json(
    { ok: false, message: 'This link has expired. Ask for a new one.' },
    { status: 401 },
  )
  if (!token) return expired

  const { data } = await freshAuthClient().auth.getUser(token)
  const authUser = data?.user
  const user = authUser?.email ? await userByEmail(authUser.email) : null
  if (!authUser || !user?.active) return expired

  const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password })
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 })
  await supabase.from('app_users').update({ must_change_password: false }).eq('id', user.id)
  await endAllSessions(user.id)
  return NextResponse.json({ ok: true })
}

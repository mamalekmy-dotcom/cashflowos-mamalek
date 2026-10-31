import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, endSession } from '@/lib/session'

export const runtime = 'nodejs'

export async function POST() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await endSession(token)
  jar.delete(SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}

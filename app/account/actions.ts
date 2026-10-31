'use server'

import { getCurrentUser } from '@/lib/auth'
import { endAllSessions, passwordMatches } from '@/lib/session'
import { supabase } from '@/lib/supabase'

export async function changePassword(current: string, next: string): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser()
  if (!user?.auth_id) return { ok: false, message: 'Please log in again.' }
  if (next.length < 10) return { ok: false, message: 'Use at least 10 characters.' }
  if (next === current) return { ok: false, message: 'Choose a different password from the current one.' }
  if (!(await passwordMatches(user.email, current))) {
    return { ok: false, message: "Your current password didn't match." }
  }
  const { error } = await supabase.auth.admin.updateUserById(user.auth_id, { password: next })
  if (error) return { ok: false, message: error.message }
  await supabase.from('app_users').update({ must_change_password: false }).eq('id', user.id)
  await endAllSessions(user.id)
  return { ok: true, message: 'Password changed. Please log in again.' }
}

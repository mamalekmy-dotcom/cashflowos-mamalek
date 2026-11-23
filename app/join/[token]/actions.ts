'use server'

import { supabase } from '@/lib/supabase'
import { POSITIONS } from '@/lib/hr/rules'
import { signupOpen } from '@/lib/signup'
import { tellOwners } from '@/lib/notify'
import { todayISO } from '@/lib/records'

type Result = { ok: boolean; message: string; loginId?: string }
const fail = (message: string): Result => ({ ok: false, message })
const clean = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()

// A staff member signing themselves up from the link the owners sent. No approval: the
// link is the permission. They get the Staff role, no bill sending, and no HR number
// (the owners key that in). The owners hear about it on Telegram.
export async function signUp(token: string, input: {
  fullName: string; email: string; password: string; position: string; phone: string
}): Promise<Result> {
  if (!(await signupOpen(token))) return fail('This sign-up link has expired. Ask your manager for the new one.')
  const name = clean(input.fullName).slice(0, 60)
  const email = input.email.trim().toLowerCase()
  const position = POSITIONS.find(p => p.label === input.position)
  const phone = clean(input.phone).slice(0, 20)
  if (name.length < 2) return fail('Type your full name.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Type a real email address. You log in with it.')
  if (input.password.length < 8) return fail('Your password needs at least 8 characters.')
  if (!position) return fail('Pick your position.')
  if (!/^\+?[\d\s-]{8,20}$/.test(phone)) return fail('Type your phone number, e.g. 012-345 6789.')

  const { data: taken } = await supabase.from('app_users').select('id').eq('email', email).maybeSingle()
  if (taken) return fail('That email already has a login. Use Log in, or Forgot password.')

  const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email, password: input.password, email_confirm: true })
  if (authError || !auth.user) return fail(/already/i.test(authError?.message ?? '') ? 'That email already has a login. Use Log in, or Forgot password.' : 'Could not create your login. Try again.')
  const undoAuth = () => supabase.auth.admin.deleteUser(auth.user.id)

  const { data: user, error: userError } = await supabase.from('app_users').insert({
    auth_id: auth.user.id, email, name, role: 'staff', must_change_password: false, can_send_bills: false,
  }).select('id').single()
  if (userError) {
    await undoAuth()
    return fail(userError.code === '23505' ? 'That email already has a login. Use Log in, or Forgot password.' : 'Could not create your login. Try again.')
  }
  const { error: personError } = await supabase.from('hr_people').insert({
    user_id: user.id, full_name: name, department: position.department, position: position.label,
    phone, join_date: todayISO(),
  })
  if (personError) {
    await supabase.from('app_users').delete().eq('id', user.id)
    await undoAuth()
    return fail('Could not save your profile. Try again.')
  }

  await tellOwners(
    `🆕 <b>${name}</b> signed up as ${position.label} (${email}, ${phone}).\n` +
      `In the app: People → key in their HR number. Admin → tick what they may use, and add their Telegram ID if they should send bills.`,
  ).catch(() => {})
  return { ok: true, message: 'You are signed up.', loginId: email }
}

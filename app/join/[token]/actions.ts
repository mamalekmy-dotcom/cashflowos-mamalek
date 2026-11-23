'use server'

import { supabase } from '@/lib/supabase'
import { POSITIONS } from '@/lib/hr/rules'
import { LOGIN_ID, cleanLoginId, signupOpen } from '@/lib/signup'
import { tellOwners } from '@/lib/notify'
import { todayISO } from '@/lib/records'

type Result = { ok: boolean; message: string; loginId?: string }
const fail = (message: string): Result => ({ ok: false, message })
const clean = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()

// A staff member signing themselves up from the link the owners sent. No approval: the
// link is the permission. They get the Staff role, no bill sending, and no HR number
// (the owners key that in). The owners hear about it on Telegram.
export async function signUp(token: string, input: {
  fullName: string; loginId: string; password: string; position: string; phone: string; telegramId: string
}): Promise<Result> {
  if (!(await signupOpen(token))) return fail('This sign-up link has expired. Ask your manager for the new one.')
  const name = clean(input.fullName).slice(0, 60)
  const loginId = cleanLoginId(input.loginId)
  const position = POSITIONS.find(p => p.label === input.position)
  const phone = clean(input.phone).slice(0, 20)
  const tg = input.telegramId.trim()
  if (name.length < 2) return fail('Type your full name.')
  if (!LOGIN_ID.test(loginId)) return fail('Your login ID: 3 to 20 letters or numbers, no spaces (a dot or _ is fine).')
  if (input.password.length < 8) return fail('Your password needs at least 8 characters.')
  if (!position) return fail('Pick your position.')
  if (tg && !/^\d{5,15}$/.test(tg)) return fail('Your Telegram ID is numbers only. Leave it empty if you are not sure.')

  const { data: taken } = await supabase.from('app_users').select('id').eq('username', loginId).maybeSingle()
  if (taken) return fail(`"${loginId}" is taken. Pick another login ID.`)
  if (tg) {
    const { data: tgTaken } = await supabase.from('app_users').select('id').eq('telegram_id', Number(tg)).maybeSingle()
    if (tgTaken) return fail('That Telegram ID is already linked to someone. Leave it empty and tell your manager.')
  }

  // Supabase logins need an email. Staff don't have to give one: a +id copy of the
  // owner's address keeps it unique and sends any reset mail to the owner.
  const { data: owner } = await supabase.from('app_users').select('email').eq('role', 'owner').eq('active', true).order('id').limit(1).maybeSingle()
  if (!owner?.email) return fail('Sign-up is not set up yet. Ask your manager.')
  const [local, domain] = String(owner.email).split('@')
  const email = `${local}+${loginId}@${domain}`

  const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email, password: input.password, email_confirm: true })
  if (authError || !auth.user) return fail(/already/i.test(authError?.message ?? '') ? `"${loginId}" is taken. Pick another login ID.` : 'Could not create your login. Try again.')
  const undoAuth = () => supabase.auth.admin.deleteUser(auth.user.id)

  const { data: user, error: userError } = await supabase.from('app_users').insert({
    auth_id: auth.user.id, email, name, role: 'staff', username: loginId, must_change_password: false,
    telegram_id: tg ? Number(tg) : null, can_send_bills: false,
  }).select('id').single()
  if (userError) {
    await undoAuth()
    return fail(userError.code === '23505' ? `"${loginId}" is taken. Pick another login ID.` : 'Could not create your login. Try again.')
  }
  const { error: personError } = await supabase.from('hr_people').insert({
    user_id: user.id, full_name: name, department: position.department, position: position.label,
    phone: phone || null, join_date: todayISO(),
  })
  if (personError) {
    await supabase.from('app_users').delete().eq('id', user.id)
    await undoAuth()
    return fail('Could not save your profile. Try again.')
  }

  await tellOwners(
    `🆕 <b>${name}</b> signed up as ${position.label} (login ID: ${loginId}).\n` +
      `In the app: People → key in their HR number. Admin → tick "Can send bills" if they should send bills.` +
      (tg ? '' : '\nNo Telegram ID yet, so the bot ignores them until one is added in Admin.'),
  ).catch(() => {})
  return { ok: true, message: 'You are signed up.', loginId }
}

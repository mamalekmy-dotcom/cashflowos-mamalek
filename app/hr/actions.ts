'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { audit, countRules, mayDecideLeave, requireHRContext, type HRContext } from '@/lib/hr/guard'
import { POSITIONS, balances, isHR, leaveDays, nextStaffNo, requestProblem, type Capability, type Part } from '@/lib/hr/rules'

// Every action re-checks who is asking. A page being reachable proves nothing.

type Result = { ok: boolean; message: string }
const fail = (message: string): Result => ({ ok: false, message })
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '')
const orNull = (s: unknown) => clean(s) || null
const PARTS: Part[] = ['full', 'am', 'pm']
const refresh = () => revalidatePath('/hr', 'layout')

async function hrOnly(): Promise<HRContext> {
  const ctx = await requireHRContext()
  if (!isHR(ctx.viewer)) throw new Error('Only HR can do this.')
  return ctx
}

// ---------------------------------------------------------------- leave
export async function applyLeave(input: {
  personId?: number; type: string; start: string; end: string; startPart: Part; endPart: Part; reason: string
}): Promise<Result> {
  const ctx = await requireHRContext()
  const personId = input.personId ?? ctx.viewer.personId
  if (!personId) return fail('Your HR profile is not set up yet. Ask HR.')
  const forSelf = personId === ctx.viewer.personId
  if (!forSelf && !isHR(ctx.viewer)) return fail('You can only apply for your own leave.')
  if (!PARTS.includes(input.startPart) || !PARTS.includes(input.endPart)) return fail('Pick full day, morning or afternoon.')

  const { data: type } = await supabase.from('hr_leave_types').select('code, allow_half_day, allow_negative, active').eq('code', input.type).maybeSingle()
  if (!type?.active) return fail('Pick a leave type.')

  // HR may record leave that already happened; staff apply ahead of time.
  const today = forSelf ? todayISO() : '0000-01-01'
  const problem = requestProblem({ ...input, allowHalfDay: type.allow_half_day }, today)
  if (problem) return fail(problem)

  const rules = await countRules()
  const { data: hols } = await supabase.from('hr_holidays').select('day').gte('day', input.start).lte('day', input.end)
  const days = leaveDays(input.start, input.end, input.startPart, input.endPart, rules, (hols ?? []).map(h => h.day as string))
  if (days <= 0) return fail('Those dates use no leave days under the current rules.')

  if (!type.allow_negative) {
    const year = Number(input.start.slice(0, 4))
    const [{ data: ledger }, { data: pending }] = await Promise.all([
      supabase.from('hr_leave_ledger').select('leave_type, year, delta, kind').eq('person_id', personId).eq('leave_type', type.code).eq('year', year),
      supabase.from('hr_leave_requests').select('leave_type, start_date, days').eq('person_id', personId).eq('leave_type', type.code).eq('status', 'pending'),
    ])
    const [b] = balances(ledger ?? [], pending ?? [], year, [type.code])
    if (days > b.available) return fail(`That needs ${days} day(s) but only ${b.available} are available.`)
  }

  const { data, error } = await supabase.from('hr_leave_requests').insert({
    person_id: personId, leave_type: type.code, start_date: input.start, end_date: input.end,
    start_part: input.startPart, end_part: input.endPart, days, reason: orNull(input.reason), created_by: ctx.viewer.userId,
  }).select('id').single()
  if (error) {
    if (error.code === '23P01') return fail('You already have leave on some of those dates.')
    return fail(error.message)
  }
  await audit(ctx, 'apply', 'hr_leave_requests', data.id, { days, forSelf })
  refresh()
  return { ok: true, message: `Sent for approval: ${days} day(s).` }
}

async function loadRequest(id: number) {
  const { data } = await supabase.from('hr_leave_requests').select('id, person_id, status, version').eq('id', id).maybeSingle()
  return data
}

const OUTCOMES: Record<string, string> = {
  stale: 'Someone changed this request just now. Refresh and check again.',
  not_pending: 'This request was already decided.',
}

export async function decideLeave(id: number, version: number, approve: boolean, note: string): Promise<Result> {
  const ctx = await requireHRContext()
  const req = await loadRequest(id)
  if (!req || !mayDecideLeave(ctx, req.person_id)) return fail('You can’t decide this request.')
  const { data, error } = await supabase.rpc('hr_decide_leave', {
    p_request: id, p_version: version, p_approve: approve, p_actor: ctx.viewer.userId, p_note: orNull(note),
  })
  if (error) return fail(error.message)
  if (data !== 'ok') return fail(OUTCOMES[data as string] ?? 'Not saved.')
  refresh()
  return { ok: true, message: approve ? 'Approved.' : 'Rejected.' }
}

// Staff can withdraw their own pending request. Cancelling approved leave gives the
// days back, so it stays with whoever may decide that person's leave.
export async function cancelLeave(id: number, version: number, note: string): Promise<Result> {
  const ctx = await requireHRContext()
  const req = await loadRequest(id)
  if (!req) return fail('Request not found.')
  const own = req.person_id === ctx.viewer.personId
  const allowed = (own && req.status === 'pending') || (req.status === 'approved' && mayDecideLeave(ctx, req.person_id))
  if (!allowed) return fail(own ? 'Approved leave is cancelled by your supervisor or HR.' : 'You can’t cancel this request.')
  const { data, error } = await supabase.rpc('hr_cancel_leave', {
    p_request: id, p_version: version, p_actor: ctx.viewer.userId, p_note: orNull(note),
  })
  if (error) return fail(error.message)
  if (data !== 'ok') return fail(OUTCOMES[data as string] ?? 'Not saved.')
  refresh()
  return { ok: true, message: 'Cancelled.' }
}

export async function addLedgerLine(personId: number, type: string, year: number, delta: number, kind: string, note: string): Promise<Result> {
  const ctx = await hrOnly()
  if (!['entitlement', 'accrual', 'adjustment'].includes(kind)) return fail('Pick entitlement, accrual or adjustment.')
  if (!Number.isFinite(delta) || delta === 0) return fail('Enter the number of days (use minus to take days away).')
  if (!Number.isInteger(year) || year < 2000) return fail('Pick the leave year.')
  if (!clean(note)) return fail('Say where this number comes from, e.g. the policy or letter.')
  const { data, error } = await supabase.from('hr_leave_ledger').insert({
    person_id: personId, leave_type: type, year, delta, kind, note: clean(note), created_by: ctx.viewer.userId,
  }).select('id').single()
  if (error) return fail(error.message)
  await audit(ctx, 'ledger', 'hr_leave_ledger', data.id, { personId, type, year, delta, kind })
  refresh()
  return { ok: true, message: 'Added to the leave history.' }
}

// ---------------------------------------------------------------- people
export type PersonForm = {
  id?: number; full_name: string; preferred_name: string; department: string; position: string
  career_level: string; manager_id: string; user_id: string; join_date: string; employment_status: string
  probation_end: string; next_review_date: string; phone: string; emergency_contacts: string
}

async function newStaffNo(): Promise<string> {
  const { data } = await supabase.from('hr_people').select('staff_no').not('staff_no', 'is', null)
  return nextStaffNo((data ?? []).map(p => p.staff_no))
}

// One step for a new hire: their login, their profile and their staff ID. Staff log in
// with the ID, so the email is optional. Without one, the login uses a +ML001 copy of
// the owner's own address, which keeps it unique and sends any reset mail to the owner.
export async function createStaff(input: {
  fullName: string; position: string; phone: string; email: string; joinDate: string
}): Promise<Result & { staffNo?: string; tempPassword?: string }> {
  const ctx = await requireHRContext()
  const owner = await getCurrentUser()
  if (ctx.viewer.appRole !== 'owner' || !owner) return fail('Only an owner can create a staff login.')
  const name = clean(input.fullName)
  const position = POSITIONS.find(p => p.label === input.position)
  if (!name) return fail('Enter the full name.')
  if (!position) return fail('Pick a position.')
  if (input.joinDate && !isDate(input.joinDate)) return fail('Check the join date.')
  const typed = clean(input.email).toLowerCase()
  if (typed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed)) return fail('That email doesn’t look right.')

  const staffNo = await newStaffNo()
  const [local, domain] = owner.email.split('@')
  const email = typed || `${local}+${staffNo.toLowerCase()}@${domain}`
  const password = randomBytes(9).toString('base64url')

  const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (authError || !auth.user) return fail(authError?.message ?? 'Could not create the login.')
  const undoAuth = () => supabase.auth.admin.deleteUser(auth.user.id)

  const { data: user, error: userError } = await supabase.from('app_users')
    .insert({ auth_id: auth.user.id, email, name, role: 'staff' }).select('id').single()
  if (userError) {
    await undoAuth()
    return fail(userError.message)
  }
  const { data: person, error: personError } = await supabase.from('hr_people').insert({
    user_id: user.id, staff_no: staffNo, full_name: name, department: position.department, position: position.label,
    phone: orNull(input.phone), join_date: orNull(input.joinDate) ?? todayISO(),
  }).select('id').single()
  if (personError) {
    await supabase.from('app_users').delete().eq('id', user.id)
    await undoAuth()
    return fail(personError.message)
  }
  await audit(ctx, 'create', 'hr_people', person.id, { staffNo, position: position.label })
  refresh()
  return { ok: true, message: `${name} is set up.`, staffNo, tempPassword: password }
}

export async function savePerson(f: PersonForm): Promise<Result & { id?: number }> {
  const ctx = await hrOnly()
  if (!clean(f.full_name)) return fail('Enter the full name.')
  for (const d of [f.join_date, f.probation_end, f.next_review_date]) if (d && !isDate(d)) return fail('Check the dates.')
  if (!['probation', 'confirmed', 'notice', 'left'].includes(f.employment_status)) return fail('Pick an employment status.')
  const row = {
    full_name: clean(f.full_name), preferred_name: orNull(f.preferred_name), department: orNull(f.department),
    position: orNull(f.position), career_level: orNull(f.career_level),
    manager_id: f.manager_id ? Number(f.manager_id) : null, user_id: f.user_id ? Number(f.user_id) : null,
    join_date: orNull(f.join_date), employment_status: f.employment_status, probation_end: orNull(f.probation_end),
    next_review_date: orNull(f.next_review_date), phone: orNull(f.phone),
    emergency_contacts: clean(f.emergency_contacts) ? [{ note: clean(f.emergency_contacts) }] : [],
    updated_at: new Date().toISOString(),
  }
  if (f.id && row.manager_id === f.id) return fail('Someone can’t report to themselves.')
  const q = f.id
    ? supabase.from('hr_people').update(row).eq('id', f.id).select('id').single()
    : supabase.from('hr_people').insert({ ...row, staff_no: await newStaffNo() }).select('id').single()
  const { data, error } = await q
  if (error) return fail(error.code === '23505' ? 'That login already belongs to another profile.' : error.message)
  await audit(ctx, f.id ? 'update' : 'create', 'hr_people', data.id, { fields: Object.keys(row) })
  refresh()
  return { ok: true, message: 'Saved.', id: data.id }
}

export async function savePrivate(personId: number, f: { id_number: string; bank_details: string; salary: string; medical_notes: string }): Promise<Result> {
  const ctx = await hrOnly()
  const salary = clean(f.salary) ? Number(f.salary) : null
  if (salary !== null && !Number.isFinite(salary)) return fail('Salary must be a number.')
  const { error } = await supabase.from('hr_people_private').upsert({
    person_id: personId, id_number: orNull(f.id_number), bank_details: orNull(f.bank_details), salary,
    medical_notes: orNull(f.medical_notes), updated_at: new Date().toISOString(),
  })
  if (error) return fail(error.message)
  // Which fields changed, never their values: the audit trail is wider than this table.
  await audit(ctx, 'update', 'hr_people_private', personId, {})
  refresh()
  return { ok: true, message: 'Restricted details saved.' }
}

// ---------------------------------------------------------------- settings
export async function saveLeaveType(f: { code: string; name: string; allow_half_day: boolean; allow_negative: boolean; active: boolean; notes: string }): Promise<Result> {
  const ctx = await hrOnly()
  const code = clean(f.code).toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!code || !clean(f.name)) return fail('Give the leave type a short code and a name.')
  const { error } = await supabase.from('hr_leave_types').upsert({
    code, name: clean(f.name), allow_half_day: f.allow_half_day, allow_negative: f.allow_negative,
    active: f.active, notes: orNull(f.notes), updated_at: new Date().toISOString(),
  })
  if (error) return fail(error.message)
  await audit(ctx, 'save', 'hr_leave_types', null, { code })
  refresh()
  return { ok: true, message: 'Leave type saved.' }
}

export async function saveHoliday(day: string, name: string): Promise<Result> {
  const ctx = await hrOnly()
  if (!isDate(day) || !clean(name)) return fail('Pick the date and give it a name.')
  const { error } = await supabase.from('hr_holidays').upsert({ day, name: clean(name) })
  if (error) return fail(error.message)
  await audit(ctx, 'save', 'hr_holidays', null, { day })
  refresh()
  return { ok: true, message: 'Holiday saved.' }
}

export async function removeHoliday(day: string): Promise<Result> {
  const ctx = await hrOnly()
  const { error } = await supabase.from('hr_holidays').delete().eq('day', day)
  if (error) return fail(error.message)
  await audit(ctx, 'remove', 'hr_holidays', null, { day })
  refresh()
  return { ok: true, message: 'Removed.' }
}

export async function saveCountRules(skipWeekdays: number[], skipHolidays: boolean): Promise<Result> {
  const ctx = await hrOnly()
  const days = [...new Set(skipWeekdays)].filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
  const { error } = await supabase.from('app_settings').upsert({
    key: 'hr_leave_count_rules', value: { skipWeekdays: days, skipHolidays }, updated_at: new Date().toISOString(),
  })
  if (error) return fail(error.message)
  await audit(ctx, 'save', 'app_settings', null, { key: 'hr_leave_count_rules', skipWeekdays: days, skipHolidays })
  refresh()
  return { ok: true, message: 'Counting rules saved. They apply to new requests only.' }
}

export async function addGrant(userId: number, capability: Capability, department: string): Promise<Result> {
  const ctx = await hrOnly()
  if (!['hr_admin', 'supervisor', 'trainer'].includes(capability)) return fail('Pick a capability.')
  // Making someone an HR admin hands them restricted data, so only an owner may.
  if (capability === 'hr_admin' && ctx.viewer.appRole !== 'owner') return fail('Only an owner can add an HR admin.')
  const { error } = await supabase.from('hr_grants').insert({
    user_id: userId, capability, department: clean(department) || '*', created_by: ctx.viewer.userId,
  })
  if (error) return fail(error.code === '23505' ? 'They already have that.' : error.message)
  await audit(ctx, 'grant', 'hr_grants', userId, { capability, department })
  refresh()
  return { ok: true, message: 'Added.' }
}

export async function removeGrant(id: number): Promise<Result> {
  const ctx = await hrOnly()
  const { data } = await supabase.from('hr_grants').select('user_id, capability, department').eq('id', id).maybeSingle()
  if (!data) return fail('Already removed.')
  if (data.capability === 'hr_admin' && ctx.viewer.appRole !== 'owner') return fail('Only an owner can remove an HR admin.')
  const { error } = await supabase.from('hr_grants').delete().eq('id', id)
  if (error) return fail(error.message)
  await audit(ctx, 'revoke', 'hr_grants', data.user_id, data)
  refresh()
  return { ok: true, message: 'Removed.' }
}

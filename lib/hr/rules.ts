// HR rules as plain functions: plain data in, plain data out, so they can be tested
// without a database (scripts/hr-tests). No imports on purpose.

export type Part = 'full' | 'am' | 'pm'
export type LedgerKind = 'entitlement' | 'accrual' | 'taken' | 'reversal' | 'adjustment'
export type LedgerRow = { leave_type: string; year: number; delta: number; kind: LedgerKind }
export type PendingRow = { leave_type: string; start_date: string; days: number }

// How leave days are counted. Management decides; until then every calendar day
// counts, because the restaurant opens every day including public holidays.
export type CountRules = { skipWeekdays: number[]; skipHolidays: boolean }
export const DEFAULT_COUNT_RULES: CountRules = { skipWeekdays: [], skipHolidays: false }

const DAY_MS = 86_400_000
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() // 0 = Sunday

// Every date from start to end, inclusive.
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let n = dayNumber(start); n <= dayNumber(end); n++) out.push(new Date(n * DAY_MS).toISOString().slice(0, 10))
  return out
}

// Days a request uses. A half day is 0.5: 'pm' on the first day means you work the
// morning; 'am' on the last day means you come back after lunch.
export function leaveDays(
  start: string, end: string, startPart: Part, endPart: Part,
  rules: CountRules = DEFAULT_COUNT_RULES, holidays: string[] = [],
): number {
  const skip = new Set(rules.skipHolidays ? holidays : [])
  let total = 0
  for (const day of datesBetween(start, end)) {
    if (rules.skipWeekdays.includes(weekday(day)) || skip.has(day)) continue
    const single = start === end
    let worth = 1
    if (single) worth = startPart === 'full' ? 1 : 0.5
    else if (day === start && startPart !== 'full') worth = 0.5
    else if (day === end && endPart !== 'full') worth = 0.5
    total += worth
  }
  return total
}

export type RequestInput = {
  start: string; end: string; startPart: Part; endPart: Part
  allowHalfDay: boolean
}

// Plain-English problem with a request, or null if it's fine to save.
export function requestProblem(r: RequestInput, today: string): string | null {
  if (!isDate(r.start) || !isDate(r.end)) return 'Pick a start and end date.'
  if (r.end < r.start) return 'The end date is before the start date.'
  if (r.start.slice(0, 4) !== r.end.slice(0, 4)) return 'Split leave that crosses the new year into two requests.'
  if (r.start < today) return 'The start date has passed. Ask HR to record past leave.'
  if (!r.allowHalfDay && (r.startPart !== 'full' || r.endPart !== 'full')) return 'This leave type is full days only.'
  if (r.start === r.end && r.endPart !== r.startPart && r.endPart !== 'full') return 'A one-day request is either a full day, a morning or an afternoon.'
  if (r.start !== r.end && r.startPart === 'am') return 'Leave starting in the morning is a full first day.'
  if (r.start !== r.end && r.endPart === 'pm') return 'Leave ending in the afternoon is a full last day.'
  return null
}

export type Balance = {
  leave_type: string
  entitled: number   // entitlement + accrual + adjustments
  used: number       // taken minus reversals
  pending: number    // waiting for a decision
  balance: number    // entitled − used
  available: number  // balance − pending
}

// Balances for one person and one year. Everything comes from the ledger, so each
// number can be explained line by line.
export function balances(ledger: LedgerRow[], pending: PendingRow[], year: number, types: string[]): Balance[] {
  return types.map(type => {
    const rows = ledger.filter(l => l.leave_type === type && l.year === year)
    const sum = (kinds: LedgerKind[]) => rows.filter(r => kinds.includes(r.kind)).reduce((s, r) => s + Number(r.delta), 0)
    const entitled = sum(['entitlement', 'accrual', 'adjustment'])
    const used = -sum(['taken', 'reversal'])
    const waiting = pending
      .filter(p => p.leave_type === type && Number(p.start_date.slice(0, 4)) === year)
      .reduce((s, p) => s + Number(p.days), 0)
    const balance = entitled - used
    return { leave_type: type, entitled, used, pending: waiting, balance, available: balance - waiting }
  })
}

// ---------------------------------------------------------------
// Who may see or act on whom. The server calls these with rows it loaded itself.
// ---------------------------------------------------------------
export type Capability = 'hr_admin' | 'supervisor' | 'trainer'
export type Grant = { capability: Capability; department: string }
export type PersonLite = { id: number; user_id: number | null; manager_id: number | null; department: string | null }
export type Viewer = { userId: number; appRole: string; personId: number | null; grants: Grant[] }

export const isHR = (v: Viewer) => v.appRole === 'owner' || v.grants.some(g => g.capability === 'hr_admin')

// Everyone below this person in the manager chain (not including them).
export function reportsOf(people: PersonLite[], managerId: number): Set<number> {
  const found = new Set<number>()
  const queue = [managerId]
  while (queue.length) {
    const boss = queue.shift() as number
    for (const p of people) {
      if (p.manager_id === boss && !found.has(p.id) && p.id !== managerId) {
        found.add(p.id)
        queue.push(p.id)
      }
    }
  }
  return found
}

// People this viewer supervises: their reports, plus whole departments a
// supervisor grant covers. Never themselves.
export function teamOf(v: Viewer, people: PersonLite[]): Set<number> {
  if (!v.grants.some(g => g.capability === 'supervisor')) return new Set()
  const team = v.personId ? reportsOf(people, v.personId) : new Set<number>()
  for (const g of v.grants.filter(g => g.capability === 'supervisor')) {
    for (const p of people) if (g.department === '*' || p.department === g.department) team.add(p.id)
  }
  if (v.personId) team.delete(v.personId)
  return team
}

export const canSeePerson = (v: Viewer, people: PersonLite[], personId: number) =>
  isHR(v) || v.personId === personId || teamOf(v, people).has(personId)

// Deciding leave: HR, or a supervisor over that person. Nobody decides their own.
export const canDecideLeave = (v: Viewer, people: PersonLite[], personId: number) =>
  v.personId !== personId && (isHR(v) || teamOf(v, people).has(personId))

// Restricted fields (salary, IC, bank, medical) and documents: HR only.
export const canSeeRestricted = (v: Viewer) => isHR(v)

// ---------------------------------------------------------------
// Training. A trainer reaches someone's TRAINING records only: through a
// department trainer grant, or by being named on their onboarding plan. That never
// widens canSeePerson, so profiles, leave and restricted fields stay closed.
// ---------------------------------------------------------------
export type PlanTrainers = { person_id: number; primary_trainer_id: number | null; backup_trainer_id: number | null }

export function canTrain(v: Viewer, people: PersonLite[], personId: number, plans: PlanTrainers[] = []): boolean {
  if (v.personId === personId) return false // nobody signs off their own training
  if (isHR(v) || teamOf(v, people).has(personId)) return true
  const dept = people.find(p => p.id === personId)?.department
  if (v.grants.some(g => g.capability === 'trainer' && (g.department === '*' || g.department === dept))) return true
  return plans.some(p => p.person_id === personId && (p.primary_trainer_id === v.userId || p.backup_trainer_id === v.userId))
}

// Does this assignment apply to this person?
export type AssignmentLite = { target_kind: string; target: string | null }
export function assignmentApplies(a: AssignmentLite, p: { id: number; department: string | null; position: string | null }): boolean {
  if (a.target_kind === 'everyone') return true
  if (a.target_kind === 'department') return !!p.department && a.target === p.department
  if (a.target_kind === 'position') return !!p.position && a.target?.toLowerCase() === p.position.toLowerCase()
  if (a.target_kind === 'person') return a.target === String(p.id)
  return false
}

export type LearningState = 'done' | 'due' | 'overdue' | 'refresher_due' | 'new_version'
export type Completion = { version: number; completed_at: string; kind: 'self' | 'trainer' }

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
export const addDaysISO = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

// Where one person stands on one course. Practical courses only count a trainer's
// sign-off; the rest count the person's own completion too. `from` is the later of
// the assignment date and the person's join date.
export function learningState(
  opts: { practical: boolean; currentVersion: number; dueDays: number; refresherMonths: number | null; from: string; today: string },
  completions: Completion[],
): { state: LearningState; due: string } {
  const counted = completions.filter(c => !opts.practical || c.kind === 'trainer')
  const latest = [...counted].sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0]
  const firstDue = addDaysISO(opts.from, opts.dueDays)
  if (!latest) return { state: opts.today > firstDue ? 'overdue' : 'due', due: firstDue }
  if (latest.version < opts.currentVersion) return { state: 'new_version', due: opts.today }
  if (opts.refresherMonths) {
    const again = addMonths(latest.completed_at, opts.refresherMonths)
    if (opts.today >= again) return { state: 'refresher_due', due: again }
    return { state: 'done', due: again }
  }
  return { state: 'done', due: '' }
}

// Where an onboarding task stands, from its four separate records.
export type TaskRecords = { instructed_at: string | null; practised_at: string | null; acknowledged_at: string | null; assessed_at: string | null; outcome: string | null; due_date: string | null }
export function taskState(t: TaskRecords, today: string): 'done' | 'follow_up' | 'overdue' | 'open' {
  if (t.outcome === 'competent' && t.acknowledged_at) return 'done'
  if (t.outcome === 'needs_follow_up' || t.outcome === 'not_yet') return 'follow_up'
  if (t.due_date && t.due_date < today) return 'overdue'
  return 'open'
}

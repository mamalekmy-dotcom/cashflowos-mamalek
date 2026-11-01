// Tests for lib/hr/rules.ts. Run: node --test scripts/hr-tests/  (Node 22.6+ strips the types itself)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leaveDays, requestProblem, balances, teamOf, canSeePerson, canDecideLeave, canSeeRestricted, isHR,
} from '../../lib/hr/rules.ts'

const TODAY = '2026-11-01'
const ok = { startPart: 'full', endPart: 'full', allowHalfDay: true }

test('leave days: full days, half days and one-day halves', () => {
  assert.equal(leaveDays('2026-12-01', '2026-12-03', 'full', 'full'), 3)
  assert.equal(leaveDays('2026-12-01', '2026-12-03', 'pm', 'full'), 2.5)
  assert.equal(leaveDays('2026-12-01', '2026-12-03', 'pm', 'am'), 2)
  assert.equal(leaveDays('2026-12-01', '2026-12-01', 'am', 'am'), 0.5)
  assert.equal(leaveDays('2026-12-01', '2026-12-01', 'full', 'full'), 1)
})

test('leave days: holidays and weekdays only skipped when the rules say so', () => {
  const hol = ['2026-12-25']
  assert.equal(leaveDays('2026-12-24', '2026-12-26', 'full', 'full', undefined, hol), 3)
  assert.equal(leaveDays('2026-12-24', '2026-12-26', 'full', 'full', { skipWeekdays: [], skipHolidays: true }, hol), 2)
  // 2026-12-06 is a Sunday
  assert.equal(leaveDays('2026-12-05', '2026-12-07', 'full', 'full', { skipWeekdays: [0], skipHolidays: false }), 2)
})

test('request problems are caught in plain words', () => {
  assert.equal(requestProblem({ ...ok, start: '2026-12-02', end: '2026-12-01' }, TODAY), 'The end date is before the start date.')
  assert.match(requestProblem({ ...ok, start: '2026-12-31', end: '2027-01-02' }, TODAY), /new year/)
  assert.match(requestProblem({ ...ok, start: '2026-10-01', end: '2026-10-01' }, TODAY), /passed/)
  assert.match(requestProblem({ ...ok, allowHalfDay: false, startPart: 'pm', start: '2026-12-01', end: '2026-12-02' }, TODAY), /full days only/)
  assert.match(requestProblem({ ...ok, startPart: 'am', start: '2026-12-01', end: '2026-12-02' }, TODAY), /full first day/)
  assert.equal(requestProblem({ ...ok, startPart: 'pm', start: '2026-12-01', end: '2026-12-02' }, TODAY), null)
  assert.equal(requestProblem({ ...ok, startPart: 'am', endPart: 'am', start: '2026-12-01', end: '2026-12-01' }, TODAY), null)
})

test('balances come only from the ledger and pending requests', () => {
  const ledger = [
    { leave_type: 'al', year: 2026, delta: 8, kind: 'entitlement' },
    { leave_type: 'al', year: 2026, delta: -2, kind: 'taken' },
    { leave_type: 'al', year: 2026, delta: 2, kind: 'reversal' },
    { leave_type: 'al', year: 2026, delta: -1.5, kind: 'taken' },
    { leave_type: 'al', year: 2026, delta: 0.5, kind: 'adjustment' },
    { leave_type: 'al', year: 2025, delta: 8, kind: 'entitlement' },
  ]
  const pending = [{ leave_type: 'al', start_date: '2026-12-10', days: 1 }, { leave_type: 'al', start_date: '2027-01-02', days: 3 }]
  const [b] = balances(ledger, pending, 2026, ['al'])
  assert.deepEqual(b, { leave_type: 'al', entitled: 8.5, used: 1.5, pending: 1, balance: 7, available: 6 })
})

// A small shop: Boss (1) manages Sup (2), who manages Ali (3); Bee (4) is BOH.
const people = [
  { id: 1, user_id: 10, manager_id: null, department: 'Management' },
  { id: 2, user_id: 20, manager_id: 1, department: 'FOH' },
  { id: 3, user_id: 30, manager_id: 2, department: 'FOH' },
  { id: 4, user_id: 40, manager_id: 1, department: 'BOH' },
]
const viewer = (personId, appRole = 'staff', grants = []) => ({ userId: personId * 10, appRole, personId, grants })
const sup = viewer(2, 'staff', [{ capability: 'supervisor', department: 'FOH' }])
const trainer = viewer(4, 'staff', [{ capability: 'trainer', department: '*' }])
const ali = viewer(3)
const hr = viewer(1, 'staff', [{ capability: 'hr_admin', department: '*' }])

test('employees see only themselves', () => {
  assert.equal(canSeePerson(ali, people, 3), true)
  assert.equal(canSeePerson(ali, people, 2), false)
  assert.equal(canSeePerson(ali, people, 4), false)
})

test('supervisors see their team, never decide their own leave', () => {
  assert.deepEqual([...teamOf(sup, people)].sort(), [3])
  assert.equal(canDecideLeave(sup, people, 3), true)
  assert.equal(canDecideLeave(sup, people, 2), false)
  assert.equal(canDecideLeave(sup, people, 4), false)
})

test('trainer grant gives no people access and no restricted fields', () => {
  assert.equal(canSeePerson(trainer, people, 3), false)
  assert.equal(canDecideLeave(trainer, people, 3), false)
  assert.equal(canSeeRestricted(trainer), false)
  assert.equal(canSeeRestricted(sup), false)
})

test('HR and owners see everyone and restricted fields, but not decide their own', () => {
  assert.equal(isHR(hr), true)
  assert.equal(canSeeRestricted(hr), true)
  assert.equal(canDecideLeave(hr, people, 4), true)
  assert.equal(canDecideLeave(hr, people, 1), false)
  assert.equal(isHR(viewer(9, 'owner')), true)
})

test('a supervisor with no profile still gets their department, minus nobody', () => {
  const v = { userId: 99, appRole: 'staff', personId: null, grants: [{ capability: 'supervisor', department: 'BOH' }] }
  assert.deepEqual([...teamOf(v, people)], [4])
})

// ---------------------------------------------------------------- step 2
import { canTrain, assignmentApplies, learningState, taskState } from '../../lib/hr/rules.ts'

test('trainers reach training only: by department grant or being named on the plan', () => {
  const deptTrainer = viewer(4, 'staff', [{ capability: 'trainer', department: 'FOH' }])
  assert.equal(canTrain(deptTrainer, people, 3), true)        // Ali is FOH
  assert.equal(canTrain(deptTrainer, people, 1), false)       // Boss is Management
  assert.equal(canSeePerson(deptTrainer, people, 3), false)   // still no profile or leave
  assert.equal(canSeeRestricted(deptTrainer), false)
  const named = viewer(4)
  const plans = [{ person_id: 3, primary_trainer_id: null, backup_trainer_id: 40 }]
  assert.equal(canTrain(named, people, 3, plans), true)       // backup trainer on Ali's plan
  assert.equal(canTrain(named, people, 2, plans), false)
  assert.equal(canTrain(viewer(3, 'staff', [{ capability: 'trainer', department: '*' }]), people, 3), false) // not yourself
  assert.equal(canTrain(sup, people, 3), true)                // supervisor of Ali
  assert.equal(canTrain(ali, people, 2), false)               // plain staff
})

test('assignments match everyone, department, position (any case) or one person', () => {
  const p = { id: 3, department: 'FOH', position: 'FOH Crew' }
  assert.equal(assignmentApplies({ target_kind: 'everyone', target: null }, p), true)
  assert.equal(assignmentApplies({ target_kind: 'department', target: 'BOH' }, p), false)
  assert.equal(assignmentApplies({ target_kind: 'position', target: 'foh crew' }, p), true)
  assert.equal(assignmentApplies({ target_kind: 'person', target: '3' }, p), true)
  assert.equal(assignmentApplies({ target_kind: 'person', target: '4' }, p), false)
})

test('learning state: due, overdue, done, new version, refresher', () => {
  const base = { practical: false, currentVersion: 1, dueDays: 14, refresherMonths: null, from: '2026-10-01', today: '2026-10-10' }
  assert.deepEqual(learningState(base, []), { state: 'due', due: '2026-10-15' })
  assert.deepEqual(learningState({ ...base, today: '2026-10-16' }, []), { state: 'overdue', due: '2026-10-15' })
  const done = [{ version: 1, completed_at: '2026-10-05T03:00:00Z', kind: 'self' }]
  assert.equal(learningState(base, done).state, 'done')
  assert.equal(learningState({ ...base, currentVersion: 2 }, done).state, 'new_version')
  assert.equal(learningState({ ...base, refresherMonths: 6, today: '2027-04-05' }, done).state, 'refresher_due')
  assert.equal(learningState({ ...base, refresherMonths: 6, today: '2027-04-04' }, done).state, 'done')
})

test('practical courses need a trainer sign-off, not just self-completion', () => {
  const base = { practical: true, currentVersion: 1, dueDays: 7, refresherMonths: null, from: '2026-10-01', today: '2026-10-03' }
  assert.equal(learningState(base, [{ version: 1, completed_at: '2026-10-02', kind: 'self' }]).state, 'due')
  assert.equal(learningState(base, [{ version: 1, completed_at: '2026-10-02', kind: 'trainer' }]).state, 'done')
})

test('onboarding task is done only when assessed competent AND acknowledged', () => {
  const t = { instructed_at: 'x', practised_at: 'x', acknowledged_at: null, assessed_at: 'x', outcome: 'competent', due_date: '2026-10-01' }
  assert.equal(taskState(t, '2026-10-05'), 'overdue')
  assert.equal(taskState({ ...t, acknowledged_at: 'x' }, '2026-10-05'), 'done')
  assert.equal(taskState({ ...t, outcome: 'needs_follow_up' }, '2026-10-05'), 'follow_up')
  assert.equal(taskState({ ...t, outcome: null, due_date: null }, '2026-10-05'), 'open')
})

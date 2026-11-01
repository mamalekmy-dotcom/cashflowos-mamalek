// Tests for lib/hr/rules.ts. Run: node --test scripts/hr-tests/  (Node 22.6+ strips the types itself)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leaveDays, requestProblem, balances, teamOf, canSeePerson, canDecideLeave, canSeeRestricted, isHR, nextStaffNo,
} from '../../lib/hr/rules.ts'

const TODAY = '2026-11-01'
const ok = { startPart: 'full', endPart: 'full', allowHalfDay: true }

test('staff IDs: start at ML001, follow the highest, ignore anything else', () => {
  assert.equal(nextStaffNo([]), 'ML001')
  assert.equal(nextStaffNo(['ML001', 'ML009', 'ML003']), 'ML010')
  assert.equal(nextStaffNo([null, 'OLD7']), 'ML001')
  assert.equal(nextStaffNo(['ML999']), 'ML1000')
})

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

import 'server-only'
import { supabase } from './supabase'

// The Leaves tab: every current staff member's annual leave left (from the HR ledger),
// MC left this month (2 a month, no carry-over), next approved leave, and the
// requests waiting for a decision.

export const MC_PER_MONTH = 2
export const AL = 'AL'
export const MC = 'MC'

export type LeaveRow = {
  id: number; name: string; position: string | null; department: string | null
  annualLeft: number | null; mcLeft: number; nextLeave: string | null; onLeaveToday: boolean
}
export type PendingLeave = {
  id: number; version: number; personId: number; name: string; type: string; typeName: string
  start: string; end: string; days: number; reason: string | null; annualAfter: number | null
}

export async function leaveBoard(today: string) {
  const year = Number(today.slice(0, 4))
  const month = today.slice(0, 7)
  const monthEnd = new Date(Date.UTC(year, Number(month.slice(5)), 0)).toISOString().slice(0, 10)
  const [{ data: people }, { data: ledger }, { data: reqs }, { data: types }] = await Promise.all([
    supabase.from('hr_people').select('id, full_name, preferred_name, position, department, employment_status, is_demo')
      .neq('employment_status', 'left').order('full_name'),
    supabase.from('hr_leave_ledger').select('person_id, leave_type, delta, kind').eq('year', year),
    supabase.from('hr_leave_requests').select('id, version, person_id, leave_type, start_date, end_date, days, reason, status')
      .in('status', ['pending', 'approved']).gte('end_date', `${year}-01-01`).order('start_date'),
    supabase.from('hr_leave_types').select('code, name'),
  ])
  const staff = (people ?? []).filter(p => !p.is_demo)
  const typeName = (c: string) => (types ?? []).find(t => t.code === c)?.name ?? c
  const balance = (personId: number, type: string) => {
    const rows = (ledger ?? []).filter(l => l.person_id === personId && l.leave_type === type)
    return rows.length ? rows.reduce((s, l) => s + Number(l.delta), 0) : null
  }
  const all = reqs ?? []
  // MC days that fall in this month (a request crossing months counts its days by date).
  const mcThisMonth = (personId: number) => all
    .filter(r => r.person_id === personId && r.leave_type === MC && r.status === 'approved' && r.start_date <= monthEnd && r.end_date >= `${month}-01`)
    .reduce((s, r) => s + Number(r.days), 0)

  const rows: LeaveRow[] = staff.map(p => {
    const mine = all.filter(r => r.person_id === p.id && r.status === 'approved')
    const next = mine.find(r => r.start_date > today)
    return {
      id: p.id, name: p.preferred_name || p.full_name, position: p.position, department: p.department,
      annualLeft: balance(p.id, AL),
      mcLeft: Math.max(0, MC_PER_MONTH - mcThisMonth(p.id)),
      nextLeave: next ? next.start_date : null,
      onLeaveToday: mine.some(r => r.start_date <= today && r.end_date >= today),
    }
  })
  const pending: PendingLeave[] = all.filter(r => r.status === 'pending').map(r => {
    const p = staff.find(s => s.id === r.person_id)
    const left = balance(r.person_id, r.leave_type)
    return {
      id: r.id, version: r.version, personId: r.person_id, name: p ? (p.preferred_name || p.full_name) : `#${r.person_id}`,
      type: r.leave_type, typeName: typeName(r.leave_type), start: r.start_date, end: r.end_date, days: Number(r.days),
      reason: r.reason, annualAfter: r.leave_type === AL && left !== null ? left - Number(r.days) : null,
    }
  })
  const count = (d: string) => staff.filter(p => (p.department || '').toUpperCase() === d).length
  return {
    rows, pending,
    summary: { active: staff.length, foh: count('FOH'), boh: count('BOH'), onLeaveToday: rows.filter(r => r.onLeaveToday).length },
  }
}

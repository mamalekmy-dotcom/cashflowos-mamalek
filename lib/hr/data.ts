import 'server-only'
import { supabase } from '@/lib/supabase'
import { balances, type Balance, type LedgerRow } from './rules'

// Reads shared by the HR pages. Callers check permission first; these just fetch.

export type LeaveType = { code: string; name: string; allow_half_day: boolean; allow_negative: boolean; active: boolean; notes: string | null }
export type LeaveRequest = {
  id: number; person_id: number; leave_type: string; start_date: string; end_date: string
  start_part: string; end_part: string; days: number; reason: string | null; status: string
  version: number; decision_note: string | null; decided_at: string | null; created_at: string
}
export type LedgerLine = LedgerRow & { id: number; note: string | null; created_at: string; request_id: number | null }

export const REQUEST_COLS = 'id, person_id, leave_type, start_date, end_date, start_part, end_part, days, reason, status, version, decision_note, decided_at, created_at'

export async function leaveTypes(): Promise<LeaveType[]> {
  const { data } = await supabase.from('hr_leave_types').select('code, name, allow_half_day, allow_negative, active, notes').order('name')
  return (data ?? []) as LeaveType[]
}

export async function leaveFor(personId: number, year: number) {
  const [types, { data: ledger }, { data: requests }] = await Promise.all([
    leaveTypes(),
    supabase.from('hr_leave_ledger').select('id, leave_type, year, delta, kind, note, created_at, request_id')
      .eq('person_id', personId).eq('year', year).order('created_at'),
    supabase.from('hr_leave_requests').select(REQUEST_COLS).eq('person_id', personId)
      .gte('end_date', `${year}-01-01`).lte('start_date', `${year}-12-31`).order('start_date', { ascending: false }),
  ])
  const reqs = (requests ?? []) as LeaveRequest[]
  const lines = (ledger ?? []) as LedgerLine[]
  // Show every active type, plus any inactive one this person still has history on.
  const codes = types.filter(t => t.active || lines.some(l => l.leave_type === t.code)).map(t => t.code)
  const bal: Balance[] = balances(lines, reqs.filter(r => r.status === 'pending'), year, codes)
  return { types, balances: bal, requests: reqs, ledger: lines }
}

export const typeName = (types: LeaveType[], code: string) => types.find(t => t.code === code)?.name ?? code

const PART: Record<string, string> = { am: ' (morning)', pm: ' (afternoon)', full: '' }
export function whenText(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'start_part' | 'end_part'>) {
  if (r.start_date === r.end_date) return `${r.start_date}${PART[r.start_part]}`
  return `${r.start_date}${PART[r.start_part]} → ${r.end_date}${PART[r.end_part]}`
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
}

export const days = (n: number) => `${Number(n)} day${Number(n) === 1 ? '' : 's'}`

'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { decideDeviceAs } from '@/lib/devices'

type Result = { ok: boolean; message: string }
const refresh = () => { revalidatePath('/'); revalidatePath('/clock') }

// Approve or reject a staff member's new phone from the Attendance tab.
export async function decideDevice(id: number, approve: boolean): Promise<Result> {
  const owner = await requireOwner()
  const r = await decideDeviceAs(id, approve, owner.id)
  if (r.ok) refresh()
  return r
}

export async function markAbsent(userId: number, day: string, undo = false): Promise<Result> {
  const owner = await requireOwner()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: 'Pick a day.' }
  const { error } = undo
    ? await supabase.from('attendance_marks').delete().eq('user_id', userId).eq('work_date', day).eq('kind', 'absent')
    : await supabase.from('attendance_marks').upsert({ user_id: userId, work_date: day, kind: 'absent', created_by: owner.id }, { onConflict: 'user_id,work_date,kind' })
  if (error) return { ok: false, message: error.message }
  refresh()
  return { ok: true, message: undo ? 'Absent mark removed.' : 'Marked absent.' }
}

// A punch someone forgot, added by an owner. Flagged "Added by manager".
export async function addPunch(userId: number, day: string, time: string, kind: string): Promise<Result> {
  const owner = await requireOwner()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, message: 'Pick the day and time.' }
  if (!['in', 'out', 'break_out', 'break_in'].includes(kind)) return { ok: false, message: 'Pick in, out or break.' }
  const at = new Date(`${day}T${time}:00+08:00`).toISOString()
  if (Date.parse(at) > Date.now()) return { ok: false, message: 'That time is in the future.' }
  const { error } = await supabase.from('punches').insert({ user_id: userId, kind, punched_at: at, flags: ['manual'], added_by: owner.id })
  if (error) return { ok: false, message: error.message }
  refresh()
  return { ok: true, message: 'Punch added.' }
}

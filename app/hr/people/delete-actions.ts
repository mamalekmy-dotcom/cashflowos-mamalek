'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

// Removes a staff member for good: their profile, leave history and, if they have one,
// their login (with its clock-ins, chats and sessions). Owners only, and never an
// owner's own account. Someone who simply left should be set to "Left" instead.
export async function deleteStaff(personId: number): Promise<Result> {
  const me = await getCurrentUser()
  if (!me || me.role !== 'owner') return { ok: false, message: 'Only an owner can delete staff.' }
  const { data: person } = await supabase.from('hr_people').select('id, full_name, user_id').eq('id', personId).maybeSingle()
  if (!person) return { ok: false, message: 'Already deleted.' }

  let login: { id: number; role: string; auth_id: string | null } | null = null
  if (person.user_id) {
    const { data } = await supabase.from('app_users').select('id, role, auth_id').eq('id', person.user_id).maybeSingle()
    login = data
    if (login?.role === 'owner') return { ok: false, message: 'This profile is linked to an owner account, so it can’t be deleted here.' }
  }

  // Ledger lines point at requests, so they go first.
  const steps = [
    () => supabase.from('hr_leave_ledger').delete().eq('person_id', personId),
    () => supabase.from('hr_leave_requests').delete().eq('person_id', personId),
    () => supabase.from('hr_people_private').delete().eq('person_id', personId),
    () => supabase.from('hr_people').update({ manager_id: null }).eq('manager_id', personId),
    () => supabase.from('hr_people').delete().eq('id', personId),
  ]
  for (const step of steps) {
    const { error } = await step()
    if (error) return { ok: false, message: `Could not delete: ${error.message}` }
  }
  if (login) {
    const { error } = await supabase.from('app_users').delete().eq('id', login.id)
    if (error) return { ok: false, message: `Profile deleted, but the login could not be: ${error.message}` }
    if (login.auth_id) await supabase.auth.admin.deleteUser(login.auth_id).catch(() => {})
  }
  await supabase.from('hr_audit').insert({ actor_id: me.id, action: 'delete', entity: 'hr_people', entity_id: personId, detail: { name: person.full_name, login: Boolean(login) } })
  revalidatePath('/hr', 'layout')
  revalidatePath('/')
  return { ok: true, message: `${person.full_name} deleted.` }
}

import 'server-only'
import { supabase } from './supabase'

// Approve or reject a staff member's new phone, as the given owner. Approving makes it
// their only phone. Callers check the owner first (the Attendance tab action, or the
// Telegram button handler).
export async function decideDeviceAs(id: number, approve: boolean, ownerId: number | null): Promise<{ ok: boolean; message: string }> {
  const { data: dev } = await supabase.from('staff_devices').select('id, user_id, status, app_users!staff_devices_user_id_fkey(name)').eq('id', id).maybeSingle()
  if (!dev) return { ok: false, message: 'That request is gone.' }
  if (dev.status !== 'pending') return { ok: false, message: `Already ${dev.status}.` }
  const now = new Date().toISOString()
  if (approve) {
    await supabase.from('staff_devices').update({ status: 'rejected', decided_by: ownerId, decided_at: now }).eq('user_id', dev.user_id).eq('status', 'approved')
  }
  const { error } = await supabase.from('staff_devices').update({ status: approve ? 'approved' : 'rejected', decided_by: ownerId, decided_at: now }).eq('id', id)
  if (error) return { ok: false, message: error.message }
  const name = (dev.app_users as any)?.name ?? 'Staff'
  return { ok: true, message: approve ? `${name}'s new phone approved. The old one no longer works.` : `${name}'s new phone rejected.` }
}

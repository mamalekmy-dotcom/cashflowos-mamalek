import { supabase } from '@/lib/supabase'
import { requireOwner } from '@/lib/auth'
import AdminPanel, { type PanelUser } from './AdminPanel'

export const dynamic = 'force-dynamic'

export default async function Admin() {
  await requireOwner()
  const { data } = await supabase
    .from('app_users')
    .select('id, name, email, role, extra_tabs, telegram_id, active')
    .order('active', { ascending: false })
    .order('name')

  return (
    <>
      <h1 className="ph">Admin</h1>
      <p className="cap">Add people, set what they can reach, and disable anyone who leaves.</p>
      <AdminPanel users={(data ?? []) as PanelUser[]} />
    </>
  )
}

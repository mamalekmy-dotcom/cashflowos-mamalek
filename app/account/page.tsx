import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { ROLES } from '@/lib/access'
import AccountForm from './AccountForm'

export const dynamic = 'force-dynamic'

export default async function Account() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const role = ROLES.find(r => r.key === user.role)?.label ?? user.role

  return (
    <>
      <h1 className="ph">My account</h1>
      <p className="cap">{user.name} · {user.email} · {role}</p>
      <AccountForm mustChange={user.must_change_password} />
    </>
  )
}

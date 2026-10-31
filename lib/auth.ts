import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, userForToken, type AppUser } from './session'

// The logged-in person for this request. cache() means the layout and the page share
// one database read. Server actions call this too, so they re-check for themselves
// instead of trusting that the page was reachable.
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  return token ? userForToken(token) : null
})

export async function requireOwner(): Promise<AppUser> {
  const user = await getCurrentUser()
  if (user?.role !== 'owner') throw new Error('Only owners can do this.')
  return user
}

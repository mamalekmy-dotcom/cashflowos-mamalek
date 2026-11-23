'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { getSignupLink, newSignupToken, saveSignupLink } from '@/lib/signup'

type Result = { ok: boolean; message: string }

export async function setSignupEnabled(enabled: boolean): Promise<Result> {
  await requireOwner()
  const link = await getSignupLink()
  await saveSignupLink({ ...link, enabled })
  revalidatePath('/hr/people')
  return { ok: true, message: enabled ? 'Sign-up link is on.' : 'Sign-up link is off. Nobody can sign up until you turn it on.' }
}

// A new link; the old one stops working at once.
export async function renewSignupLink(): Promise<Result> {
  await requireOwner()
  await saveSignupLink({ token: newSignupToken(), enabled: true })
  revalidatePath('/hr/people')
  return { ok: true, message: 'New link made. The old link no longer works.' }
}

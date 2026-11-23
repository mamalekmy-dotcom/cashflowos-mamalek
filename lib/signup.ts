import 'server-only'
import { randomBytes } from 'crypto'
import { supabase } from './supabase'

// The staff sign-up link: /join/<token>. Anyone with the link makes their own staff
// login, no approval. An owner can turn it off or make a new link (the old one then
// stops working). Kept in app_settings.
const KEY = 'signup_link'
export type SignupLink = { token: string; enabled: boolean }

// Login IDs staff pick for themselves: 3–20 letters, numbers, dot or underscore.
export const LOGIN_ID = /^[a-z0-9._]{3,20}$/
export const cleanLoginId = (s: string) => s.trim().toLowerCase()

export async function getSignupLink(): Promise<SignupLink> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  const v = data?.value as Partial<SignupLink> | undefined
  if (v?.token) return { token: v.token, enabled: v.enabled !== false }
  return saveSignupLink({ token: randomBytes(12).toString('base64url'), enabled: true })
}

export async function saveSignupLink(link: SignupLink): Promise<SignupLink> {
  const { error } = await supabase.from('app_settings').upsert({ key: KEY, value: link, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  return link
}

export const newSignupToken = () => randomBytes(12).toString('base64url')

export async function signupOpen(token: string): Promise<boolean> {
  if (!token) return false
  const link = await getSignupLink()
  return link.enabled && link.token === token
}

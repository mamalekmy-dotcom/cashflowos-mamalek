import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_COUNT_RULES, canDecideLeave, canSeePerson, isHR, teamOf,
  type CountRules, type Grant, type PersonLite, type Viewer,
} from './rules'

// The one place HR pages and actions find out who is asking and what they may touch.
// proxy.ts only decides whether a page opens; every HR read and write checks here too.

export type HRContext = { viewer: Viewer; people: PersonLite[]; name: string }

export const getHRContext = cache(async (): Promise<HRContext | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  const [{ data: grants }, { data: people }] = await Promise.all([
    supabase.from('hr_grants').select('capability, department').eq('user_id', user.id),
    supabase.from('hr_people').select('id, user_id, manager_id, department'),
  ])
  const list = (people ?? []) as PersonLite[]
  const me = list.find(p => p.user_id === user.id) ?? null
  return {
    viewer: { userId: user.id, appRole: user.role, personId: me?.id ?? null, grants: (grants ?? []) as Grant[] },
    people: list,
    name: user.name,
  }
})

export async function requireHRContext(): Promise<HRContext> {
  const ctx = await getHRContext()
  if (!ctx) redirect('/login')
  return ctx
}

// For pages only HR admins and owners may open.
export async function requireHRAdmin(): Promise<HRContext> {
  const ctx = await requireHRContext()
  if (!isHR(ctx.viewer)) redirect('/clock')
  return ctx
}

// For pages supervisors, HR and owners may open.
export async function requireManager(): Promise<HRContext> {
  const ctx = await requireHRContext()
  if (!isHR(ctx.viewer) && teamOf(ctx.viewer, ctx.people).size === 0) redirect('/clock')
  return ctx
}

// Ids this viewer may see, for filtering lists before they are rendered.
export function visiblePeople(ctx: HRContext): number[] {
  if (isHR(ctx.viewer)) return ctx.people.map(p => p.id)
  const ids = teamOf(ctx.viewer, ctx.people)
  if (ctx.viewer.personId) ids.add(ctx.viewer.personId)
  return [...ids]
}

export const mayDecideLeave = (ctx: HRContext, personId: number) => canDecideLeave(ctx.viewer, ctx.people, personId)
export const maySeePerson = (ctx: HRContext, personId: number) => canSeePerson(ctx.viewer, ctx.people, personId)

export async function audit(ctx: HRContext, action: string, entity: string, entityId: number | null, detail: object = {}) {
  await supabase.from('hr_audit').insert({ actor_id: ctx.viewer.userId, action, entity, entity_id: entityId, detail })
}

export async function countRules(): Promise<CountRules> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'hr_leave_count_rules').maybeSingle()
  return { ...DEFAULT_COUNT_RULES, ...((data?.value as Partial<CountRules> | undefined) ?? {}) }
}

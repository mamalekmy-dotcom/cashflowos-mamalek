import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_COUNT_RULES, canDecideLeave, canSeePerson, canTrain, isHR, teamOf,
  type CountRules, type Grant, type PersonLite, type PlanTrainers, type Viewer,
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
  if (!isHR(ctx.viewer)) redirect('/me')
  return ctx
}

// For pages supervisors, HR and owners may open.
export async function requireManager(): Promise<HRContext> {
  const ctx = await requireHRContext()
  if (!isHR(ctx.viewer) && teamOf(ctx.viewer, ctx.people).size === 0) redirect('/me')
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

// ---------------------------------------------------------------- training
// Active plans with their trainers, so a named trainer can reach that trainee's
// onboarding and training records (and nothing else).
export const activePlanTrainers = cache(async (): Promise<PlanTrainers[]> => {
  const { data } = await supabase.from('hr_onboarding_plans').select('person_id, primary_trainer_id, backup_trainer_id').eq('status', 'active')
  return (data ?? []) as PlanTrainers[]
})

export async function mayTrain(ctx: HRContext, personId: number): Promise<boolean> {
  return canTrain(ctx.viewer, ctx.people, personId, await activePlanTrainers())
}

// People whose training this viewer may record, for filtering lists.
export async function trainees(ctx: HRContext): Promise<number[]> {
  const plans = await activePlanTrainers()
  return ctx.people.filter(p => canTrain(ctx.viewer, ctx.people, p.id, plans)).map(p => p.id)
}

// For onboarding and training pages: HR, supervisors, trainers, and anyone named
// as a trainer on a plan. Everyone else goes to their own page.
export async function requireTrainerView(): Promise<HRContext & { trainees: number[] }> {
  const ctx = await requireHRContext()
  const ids = await trainees(ctx)
  if (!isHR(ctx.viewer) && ids.length === 0) redirect('/me')
  return { ...ctx, trainees: ids }
}

'use server'

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { audit, mayTrain, requireHRContext, type HRContext } from '@/lib/hr/guard'
import { isUrl } from '@/lib/hr/learning'
import { addDaysISO, isHR, teamOf } from '@/lib/hr/rules'

// Culture, onboarding and training actions. Each one re-checks who is asking.

type Result = { ok: boolean; message: string; id?: number }
const fail = (message: string): Result => ({ ok: false, message })
const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '')
const orNull = (s: unknown) => clean(s) || null
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
const now = () => new Date().toISOString()
const refresh = () => { revalidatePath('/me'); revalidatePath('/hr', 'layout') }

async function hrOnly(): Promise<HRContext> {
  const ctx = await requireHRContext()
  if (!isHR(ctx.viewer)) throw new Error('Only HR can do this.')
  return ctx
}
const supervises = (ctx: HRContext, personId: number) => isHR(ctx.viewer) || teamOf(ctx.viewer, ctx.people).has(personId)

// ---------------------------------------------------------------- culture
export async function saveContentItem(title: string, section: string, position: number): Promise<Result> {
  const ctx = await hrOnly()
  if (!clean(title) || !clean(section)) return fail('Give it a title and a section.')
  const { data, error } = await supabase.from('hr_content').insert({ title: clean(title), section: clean(section), position: Number(position) || 0 }).select('id').single()
  if (error) return fail(error.message)
  await audit(ctx, 'create', 'hr_content', data.id)
  refresh()
  return { ok: true, message: 'Added. Now link its Drive file as version 1.' }
}

export async function addContentVersion(contentId: number, sourceUrl: string, sourceRef: string, changeNote: string, requiresAck: boolean): Promise<Result> {
  const ctx = await hrOnly()
  if (!isUrl(clean(sourceUrl))) return fail('Paste the Drive link (starting https://).')
  const { data: last } = await supabase.from('hr_content_versions').select('version').eq('content_id', contentId).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = (last?.version ?? 0) + 1
  const { data, error } = await supabase.from('hr_content_versions').insert({
    content_id: contentId, version, source_url: clean(sourceUrl), source_ref: orNull(sourceRef),
    change_note: orNull(changeNote), requires_ack: requiresAck, created_by: ctx.viewer.userId,
  }).select('id').single()
  if (error) return fail(error.code === '23505' ? 'Someone just added a version. Refresh and try again.' : error.message)
  await audit(ctx, 'draft', 'hr_content_versions', data.id, { contentId, version })
  refresh()
  return { ok: true, message: `Version ${version} saved as a draft. Publish it when it's approved.` }
}

// Publishing retires the old version first, so staff are asked to acknowledge the
// new one. Earlier acknowledgements stay on record against the old version.
export async function publishVersion(versionId: number): Promise<Result> {
  const ctx = await hrOnly()
  const { data: v } = await supabase.from('hr_content_versions').select('id, content_id, status').eq('id', versionId).maybeSingle()
  if (!v || v.status !== 'draft') return fail('Only a draft can be published.')
  await supabase.from('hr_content_versions').update({ status: 'retired' }).eq('content_id', v.content_id).eq('status', 'published')
  const { error } = await supabase.from('hr_content_versions').update({ status: 'published', published_by: ctx.viewer.userId, published_at: now() }).eq('id', versionId).eq('status', 'draft')
  if (error) return fail(error.message)
  await audit(ctx, 'publish', 'hr_content_versions', versionId)
  refresh()
  return { ok: true, message: 'Published. Staff will see it to acknowledge.' }
}

export async function acknowledgeContent(versionId: number): Promise<Result> {
  const ctx = await requireHRContext()
  if (!ctx.viewer.personId) return fail('Your HR profile is not set up yet.')
  const { data: v } = await supabase.from('hr_content_versions').select('status').eq('id', versionId).maybeSingle()
  if (v?.status !== 'published') return fail('This version is no longer current. Refresh.')
  const { error } = await supabase.from('hr_acknowledgements').insert({ person_id: ctx.viewer.personId, version_id: versionId })
  if (error && error.code !== '23505') return fail(error.message)
  refresh()
  return { ok: true, message: 'Thanks, recorded.' }
}

export async function addFlag(contentId: number | null, kind: string, note: string): Promise<Result> {
  const ctx = await hrOnly()
  if (!['conflict', 'duplicate', 'unclear'].includes(kind) || !clean(note)) return fail('Pick a kind and describe what needs review.')
  const { error } = await supabase.from('hr_content_flags').insert({ content_id: contentId, kind, note: clean(note), created_by: ctx.viewer.userId })
  if (error) return fail(error.message)
  refresh()
  return { ok: true, message: 'Flagged for review.' }
}

export async function resolveFlag(id: number): Promise<Result> {
  const ctx = await hrOnly()
  const { error } = await supabase.from('hr_content_flags').update({ status: 'resolved', resolved_by: ctx.viewer.userId }).eq('id', id)
  if (error) return fail(error.message)
  refresh()
  return { ok: true, message: 'Resolved.' }
}

// ---------------------------------------------------------------- onboarding
export async function saveTemplate(name: string, department: string, position: string): Promise<Result> {
  const ctx = await hrOnly()
  if (!clean(name)) return fail('Name the template, e.g. "FOH crew".')
  const { data, error } = await supabase.from('hr_onboarding_templates').insert({ name: clean(name), department: orNull(department), position: orNull(position) }).select('id').single()
  if (error) return fail(error.message)
  await audit(ctx, 'create', 'hr_onboarding_templates', data.id)
  refresh()
  return { ok: true, message: 'Template added.', id: data.id }
}

export async function addTemplateTask(templateId: number, f: { checkpoint: string; day_offset: string; title: string; instruction: string; source_url: string }): Promise<Result> {
  const ctx = await hrOnly()
  if (!clean(f.checkpoint) || !clean(f.title)) return fail('Give the task a checkpoint (e.g. Day 1) and a title.')
  if (clean(f.source_url) && !isUrl(clean(f.source_url))) return fail('The link must start with https://')
  const offset = Number(f.day_offset || 0)
  if (!Number.isInteger(offset) || offset < 0) return fail('Days after start must be 0 or more.')
  const { count } = await supabase.from('hr_onboarding_template_tasks').select('id', { count: 'exact', head: true }).eq('template_id', templateId)
  const { error } = await supabase.from('hr_onboarding_template_tasks').insert({
    template_id: templateId, checkpoint: clean(f.checkpoint), day_offset: offset, title: clean(f.title),
    instruction: orNull(f.instruction), source_url: orNull(f.source_url), position: count ?? 0,
  })
  if (error) return fail(error.message)
  await audit(ctx, 'add_task', 'hr_onboarding_templates', templateId)
  refresh()
  return { ok: true, message: 'Task added. Plans already started keep their own copy.' }
}

export async function removeTemplateTask(id: number): Promise<Result> {
  const ctx = await hrOnly()
  const { error } = await supabase.from('hr_onboarding_template_tasks').delete().eq('id', id)
  if (error) return fail(error.message)
  await audit(ctx, 'remove_task', 'hr_onboarding_template_tasks', id)
  refresh()
  return { ok: true, message: 'Removed from the template.' }
}

export async function startPlan(personId: number, templateId: number, startDate: string): Promise<Result> {
  const ctx = await requireHRContext()
  if (!supervises(ctx, personId)) return fail('Only HR or their supervisor can start onboarding.')
  if (!isDate(startDate)) return fail('Pick the start date.')
  const [{ data: tpl }, { data: tasks }] = await Promise.all([
    supabase.from('hr_onboarding_templates').select('id, name, active').eq('id', templateId).maybeSingle(),
    supabase.from('hr_onboarding_template_tasks').select('checkpoint, day_offset, title, instruction, source_url, position').eq('template_id', templateId).order('day_offset').order('position'),
  ])
  if (!tpl?.active) return fail('Pick a template.')
  if (!tasks?.length) return fail('That template has no tasks yet.')
  // Trainers start blank on purpose; they're named later if at all.
  const { data: plan, error } = await supabase.from('hr_onboarding_plans').insert({
    person_id: personId, template_id: templateId, name: tpl.name, start_date: startDate, created_by: ctx.viewer.userId,
  }).select('id').single()
  if (error) return fail(error.message)
  const { error: taskError } = await supabase.from('hr_onboarding_tasks').insert(tasks.map((t, i) => ({
    plan_id: plan.id, checkpoint: t.checkpoint, title: t.title, instruction: t.instruction, source_url: t.source_url,
    due_date: addDaysISO(startDate, t.day_offset), position: i,
  })))
  if (taskError) {
    await supabase.from('hr_onboarding_plans').update({ status: 'cancelled' }).eq('id', plan.id)
    return fail(`Couldn't copy the tasks: ${taskError.message}`)
  }
  await audit(ctx, 'start', 'hr_onboarding_plans', plan.id, { personId, templateId })
  refresh()
  return { ok: true, message: 'Onboarding started.', id: plan.id }
}

async function planPerson(planId: number) {
  const { data } = await supabase.from('hr_onboarding_plans').select('person_id, status').eq('id', planId).maybeSingle()
  return data
}

export async function setPlanTrainers(planId: number, primary: string, backup: string): Promise<Result> {
  const ctx = await requireHRContext()
  const plan = await planPerson(planId)
  if (!plan || !supervises(ctx, plan.person_id)) return fail('Only HR or their supervisor can change trainers.')
  const { error } = await supabase.from('hr_onboarding_plans').update({
    primary_trainer_id: primary ? Number(primary) : null, backup_trainer_id: backup ? Number(backup) : null,
  }).eq('id', planId)
  if (error) return fail(error.message)
  await audit(ctx, 'trainers', 'hr_onboarding_plans', planId, { primary, backup })
  refresh()
  return { ok: true, message: 'Trainers saved.' }
}

export async function setPlanStatus(planId: number, status: 'active' | 'completed' | 'cancelled'): Promise<Result> {
  const ctx = await requireHRContext()
  const plan = await planPerson(planId)
  if (!plan || !supervises(ctx, plan.person_id)) return fail('Only HR or their supervisor can do this.')
  const { error } = await supabase.from('hr_onboarding_plans').update({ status }).eq('id', planId)
  if (error) return fail(error.message)
  await audit(ctx, status, 'hr_onboarding_plans', planId)
  refresh()
  return { ok: true, message: 'Saved.' }
}

async function taskPerson(taskId: number) {
  const { data } = await supabase.from('hr_onboarding_tasks').select('id, plan_id, hr_onboarding_plans(person_id, status)').eq('id', taskId).maybeSingle()
  const plan = data?.hr_onboarding_plans as unknown as { person_id: number; status: string } | undefined
  return plan ? { personId: plan.person_id, active: plan.status === 'active' } : null
}

// The trainer's three records. Each one is its own stamp; recording one never
// fills in another.
export async function recordTaskStep(taskId: number, step: 'instructed' | 'practised' | 'assessed', f: { outcome?: string; comment?: string; follow_up?: string; follow_up_due?: string } = {}): Promise<Result> {
  const ctx = await requireHRContext()
  const t = await taskPerson(taskId)
  if (!t || !(await mayTrain(ctx, t.personId))) return fail('You can’t record training for this person.')
  if (!t.active) return fail('This onboarding plan is closed.')
  let patch: Record<string, unknown>
  if (step === 'instructed') patch = { instructed_by: ctx.viewer.userId, instructed_at: now() }
  else if (step === 'practised') patch = { practised_by: ctx.viewer.userId, practised_at: now() }
  else {
    if (!['competent', 'needs_follow_up', 'not_yet'].includes(f.outcome ?? '')) return fail('Pick the outcome.')
    if (f.outcome !== 'competent' && !clean(f.follow_up)) return fail('Say what the follow-up is.')
    if (f.follow_up_due && !isDate(f.follow_up_due)) return fail('Check the follow-up date.')
    patch = {
      assessed_by: ctx.viewer.userId, assessed_at: now(), outcome: f.outcome, comment: orNull(f.comment),
      follow_up: f.outcome === 'competent' ? null : orNull(f.follow_up), follow_up_due: f.outcome === 'competent' ? null : orNull(f.follow_up_due),
    }
  }
  const { error } = await supabase.from('hr_onboarding_tasks').update(patch).eq('id', taskId)
  if (error) return fail(error.message)
  await audit(ctx, step, 'hr_onboarding_tasks', taskId, step === 'assessed' ? { outcome: f.outcome } : {})
  refresh()
  return { ok: true, message: 'Recorded.' }
}

// The employee's own acknowledgement. Only they can give it.
export async function acknowledgeTask(taskId: number): Promise<Result> {
  const ctx = await requireHRContext()
  const t = await taskPerson(taskId)
  if (!t || t.personId !== ctx.viewer.personId) return fail('Only the new staff member can acknowledge their own task.')
  const { error } = await supabase.from('hr_onboarding_tasks').update({ acknowledged_at: now() }).eq('id', taskId).is('acknowledged_at', null)
  if (error) return fail(error.message)
  refresh()
  return { ok: true, message: 'Acknowledged.' }
}

export async function addTaskComment(taskId: number, comment: string): Promise<Result> {
  const ctx = await requireHRContext()
  const t = await taskPerson(taskId)
  if (!t || !(await mayTrain(ctx, t.personId))) return fail('You can’t comment on this task.')
  if (!clean(comment)) return fail('Write the comment first.')
  const { data } = await supabase.from('hr_onboarding_tasks').select('comment').eq('id', taskId).single()
  const line = `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })} — ${clean(comment)}`
  const { error } = await supabase.from('hr_onboarding_tasks').update({ comment: data?.comment ? `${data.comment}\n${line}` : line }).eq('id', taskId)
  if (error) return fail(error.message)
  refresh()
  return { ok: true, message: 'Comment added.' }
}

// ---------------------------------------------------------------- training
export async function saveCourse(title: string, kind: string, description: string): Promise<Result> {
  const ctx = await hrOnly()
  if (!clean(title) || !['sop', 'pdf', 'video', 'text', 'practical'].includes(kind)) return fail('Give the course a title and a type.')
  const { data, error } = await supabase.from('hr_courses').insert({ title: clean(title), kind, description: orNull(description) }).select('id').single()
  if (error) return fail(error.message)
  await audit(ctx, 'create', 'hr_courses', data.id)
  refresh()
  return { ok: true, message: 'Course added. Now add version 1.' }
}

export async function addCourseVersion(courseId: number, sourceUrl: string, body: string, changeNote: string): Promise<Result> {
  const ctx = await hrOnly()
  if (clean(sourceUrl) && !isUrl(clean(sourceUrl))) return fail('The link must start with https://')
  if (!clean(sourceUrl) && !clean(body)) return fail('Add a Drive link or the lesson text.')
  const { data: last } = await supabase.from('hr_course_versions').select('version').eq('course_id', courseId).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = (last?.version ?? 0) + 1
  const { error } = await supabase.from('hr_course_versions').insert({
    course_id: courseId, version, source_url: orNull(sourceUrl), body: orNull(body), change_note: orNull(changeNote), created_by: ctx.viewer.userId,
  })
  if (error) return fail(error.code === '23505' ? 'Someone just added a version. Refresh and try again.' : error.message)
  await audit(ctx, 'version', 'hr_courses', courseId, { version })
  refresh()
  return { ok: true, message: version > 1 ? `Version ${version} is live. Anyone who finished an older version will be asked to redo it.` : 'Version 1 is live.' }
}

export async function assignCourse(courseId: number, kind: string, target: string, dueDays: number, refresherMonths: number | null): Promise<Result> {
  const ctx = await requireHRContext()
  if (!['everyone', 'department', 'position', 'person'].includes(kind)) return fail('Pick who it is for.')
  // Supervisors may assign to one person in their team; wider assignments are HR's.
  if (!isHR(ctx.viewer) && !(kind === 'person' && teamOf(ctx.viewer, ctx.people).has(Number(target)))) return fail('Only HR can assign to a whole group.')
  if (kind !== 'everyone' && !clean(target)) return fail('Pick the department, position or person.')
  if (!Number.isInteger(dueDays) || dueDays < 0) return fail('Due within must be 0 days or more.')
  if (refresherMonths !== null && (!Number.isInteger(refresherMonths) || refresherMonths <= 0)) return fail('Refresher must be a whole number of months.')
  const { error } = await supabase.from('hr_assignments').insert({
    course_id: courseId, target_kind: kind, target: kind === 'everyone' ? null : clean(target), due_days: dueDays,
    refresher_months: refresherMonths, created_by: ctx.viewer.userId,
  })
  if (error) return fail(error.message)
  await audit(ctx, 'assign', 'hr_assignments', courseId, { kind, target })
  refresh()
  return { ok: true, message: 'Assigned.' }
}

export async function completeSelf(courseVersionId: number): Promise<Result> {
  const ctx = await requireHRContext()
  if (!ctx.viewer.personId) return fail('Your HR profile is not set up yet.')
  const { data: v } = await supabase.from('hr_course_versions').select('id, hr_courses(kind)').eq('id', courseVersionId).maybeSingle()
  const kind = (v?.hr_courses as unknown as { kind: string } | undefined)?.kind
  if (!kind) return fail('Course not found.')
  if (kind === 'practical') return fail('Practical training is signed off by your trainer.')
  const { error } = await supabase.from('hr_completions').insert({ person_id: ctx.viewer.personId, course_version_id: courseVersionId, kind: 'self' })
  if (error && error.code !== '23505') return fail(error.message)
  refresh()
  return { ok: true, message: 'Marked as done.' }
}

export async function signOffTraining(personId: number, courseVersionId: number, note: string): Promise<Result> {
  const ctx = await requireHRContext()
  if (!(await mayTrain(ctx, personId))) return fail('You can’t sign off training for this person.')
  const { error } = await supabase.from('hr_completions').insert({
    person_id: personId, course_version_id: courseVersionId, kind: 'trainer', signed_off_by: ctx.viewer.userId, note: orNull(note),
  })
  if (error) return fail(error.code === '23505' ? 'Already signed off for this version.' : error.message)
  await audit(ctx, 'sign_off', 'hr_completions', personId, { courseVersionId })
  refresh()
  return { ok: true, message: 'Signed off.' }
}

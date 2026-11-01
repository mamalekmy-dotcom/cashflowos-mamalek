import 'server-only'
import { supabase } from '@/lib/supabase'
import { assignmentApplies, learningState, type Completion, type LearningState } from './rules'

// Reads for culture, onboarding and training. Callers check permission first.

export type Course = { id: number; title: string; kind: string; description: string | null; active: boolean }
export type CourseVersion = { id: number; course_id: number; version: number; source_url: string | null; body: string | null; change_note: string | null; published_at: string }
export type Assignment = { id: number; course_id: number; target_kind: string; target: string | null; due_days: number; refresher_months: number | null; active: boolean; created_at: string }
export type LearningRow = { course: Course; version: CourseVersion; assignment: Assignment; state: LearningState; due: string }

export const isUrl = (s: string) => /^https:\/\/\S+$/.test(s)

export async function coursesWithLatest() {
  const [{ data: courses }, { data: versions }, { data: assignments }] = await Promise.all([
    supabase.from('hr_courses').select('id, title, kind, description, active').order('title'),
    supabase.from('hr_course_versions').select('id, course_id, version, source_url, body, change_note, published_at').order('version', { ascending: false }),
    supabase.from('hr_assignments').select('id, course_id, target_kind, target, due_days, refresher_months, active, created_at').eq('active', true),
  ])
  const latest = new Map<number, CourseVersion>()
  for (const v of (versions ?? []) as CourseVersion[]) if (!latest.has(v.course_id)) latest.set(v.course_id, v)
  return { courses: (courses ?? []) as Course[], latest, versions: (versions ?? []) as CourseVersion[], assignments: (assignments ?? []) as Assignment[] }
}

// One person's assigned learning and where they stand on each course.
export async function learningFor(
  person: { id: number; department: string | null; position: string | null; join_date: string | null },
  today: string,
): Promise<LearningRow[]> {
  const { courses, latest, versions, assignments } = await coursesWithLatest()
  const { data: done } = await supabase.from('hr_completions').select('course_version_id, kind, completed_at').eq('person_id', person.id)
  const rows: LearningRow[] = []
  const seen = new Set<number>()
  for (const a of assignments) {
    const course = courses.find(c => c.id === a.course_id)
    const version = latest.get(a.course_id)
    if (!course?.active || !version || seen.has(course.id) || !assignmentApplies(a, person)) continue
    seen.add(course.id)
    const completions: Completion[] = (done ?? []).flatMap(d => {
      const v = versions.find(x => x.id === d.course_version_id && x.course_id === course.id)
      return v ? [{ version: v.version, completed_at: d.completed_at as string, kind: d.kind as 'self' | 'trainer' }] : []
    })
    const from = [a.created_at.slice(0, 10), person.join_date ?? ''].sort().pop() as string
    const s = learningState({ practical: course.kind === 'practical', currentVersion: version.version, dueDays: a.due_days, refresherMonths: a.refresher_months, from, today }, completions)
    rows.push({ course, version, assignment: a, ...s })
  }
  const order: Record<LearningState, number> = { overdue: 0, refresher_due: 1, new_version: 2, due: 3, done: 4 }
  return rows.sort((x, y) => order[x.state] - order[y.state])
}

export const LEARNING_LABEL: Record<LearningState, string> = {
  overdue: 'Overdue', refresher_due: 'Refresher due', new_version: 'Updated — redo', due: 'To do', done: 'Done',
}

// Published company content, and which versions this person still has to acknowledge.
export async function cultureFor(personId: number | null) {
  const [{ data: items }, { data: versions }, acks] = await Promise.all([
    supabase.from('hr_content').select('id, title, section, position').order('position').order('id'),
    supabase.from('hr_content_versions').select('id, content_id, version, source_url, source_ref, change_note, requires_ack, published_at').eq('status', 'published'),
    personId ? supabase.from('hr_acknowledgements').select('version_id, acknowledged_at').eq('person_id', personId) : Promise.resolve({ data: [] }),
  ])
  const ackOf = new Map((acks.data ?? []).map(a => [a.version_id as number, a.acknowledged_at as string]))
  return (items ?? []).flatMap(item => {
    const v = (versions ?? []).find(x => x.content_id === item.id)
    return v ? [{ item, version: v, acknowledgedAt: ackOf.get(v.id) ?? null }] : []
  })
}

export const ONBOARDING_TASK_COLS = 'id, plan_id, checkpoint, title, instruction, source_url, due_date, position, instructed_by, instructed_at, practised_by, practised_at, acknowledged_at, assessed_by, assessed_at, outcome, comment, follow_up, follow_up_due'
export type OnboardingTask = {
  id: number; plan_id: number; checkpoint: string; title: string; instruction: string | null; source_url: string | null
  due_date: string | null; position: number; instructed_by: number | null; instructed_at: string | null
  practised_by: number | null; practised_at: string | null; acknowledged_at: string | null
  assessed_by: number | null; assessed_at: string | null; outcome: string | null
  comment: string | null; follow_up: string | null; follow_up_due: string | null
}

export const OUTCOME_LABEL: Record<string, string> = { competent: 'Competent', needs_follow_up: 'Needs follow-up', not_yet: 'Not yet' }

// Short Malaysian-time stamp for "who did what, when".
export const stamp = (at: string | null) =>
  at ? new Date(at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

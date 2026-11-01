'use client'
import { useState, useTransition } from 'react'
import {
  acknowledgeContent, acknowledgeTask, addContentVersion, addCourseVersion, addFlag, addTaskComment, addTemplateTask,
  assignCourse, completeSelf, publishVersion, recordTaskStep, removeTemplateTask, resolveFlag, saveContentItem,
  saveCourse, saveTemplate, setPlanStatus, setPlanTrainers, signOffTraining, startPlan,
} from './learning-actions'

type Opt = { value: string; label: string }
type R = { ok: boolean; message: string; id?: number }
const gap = { marginTop: 10 }
const Msg = ({ text }: { text: string }) => (text ? <p className="cap" style={{ margin: '8px 0 0' }}>{text}</p> : null)

function useAction() {
  const [message, setMessage] = useState('')
  const [pending, run] = useTransition()
  const go = (fn: () => Promise<R>, after?: (r: R) => void) => run(async () => { const r = await fn(); setMessage(r.message); after?.(r) })
  return { message, pending, go }
}

function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <input className="login-input" type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  )
}
function Area({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <textarea className="login-input" rows={3} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  )
}
function Select({ label, value, onChange, options, blank }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; blank?: string }) {
  return (
    <label className="cap" style={{ display: 'block', ...gap }}>
      {label}
      <select className="login-input" value={value} onChange={e => onChange(e.target.value)}>
        {blank !== undefined ? <option value="">{blank}</option> : null}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="cap" style={{ display: 'flex', gap: 8, alignItems: 'center', ...gap }}><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} /> {label}</label>
}

// A button that runs one action, with an optional "are you sure" step.
export function ActionButton({ label, run, confirm, ghost }: { label: string; run: () => Promise<R>; confirm?: string; ghost?: boolean }) {
  const [sure, setSure] = useState(false)
  const { message, pending, go } = useAction()
  if (confirm && sure) {
    return (
      <span className="btnrow">
        <button className="btn" type="button" disabled={pending} onClick={() => go(run, () => setSure(false))}>{confirm}</button>
        <button className="btn ghost" type="button" onClick={() => setSure(false)}>Back</button>
      </span>
    )
  }
  return (
    <span>
      <button className={`btn${ghost ? ' ghost' : ''}`} type="button" disabled={pending} onClick={() => (confirm ? setSure(true) : go(run))}>{label}</button>
      <Msg text={message} />
    </span>
  )
}

// Bound to one id, so a server page can render them without passing functions.
export const AckContent = ({ versionId }: { versionId: number }) => <ActionButton label="I have read and understood this" run={() => acknowledgeContent(versionId)} />
export const PublishVersion = ({ versionId }: { versionId: number }) => <ActionButton label="Publish" confirm="Yes, publish to staff" run={() => publishVersion(versionId)} />
export const ResolveFlag = ({ id }: { id: number }) => <ActionButton label="Mark resolved" ghost run={() => resolveFlag(id)} />
export const AckTask = ({ id }: { id: number }) => <ActionButton label="I understand this" run={() => acknowledgeTask(id)} />
export const RemoveTemplateTask = ({ id }: { id: number }) => <ActionButton label="Remove" ghost confirm="Remove from template" run={() => removeTemplateTask(id)} />
export const CompleteSelf = ({ versionId }: { versionId: number }) => <ActionButton label="Mark as done" run={() => completeSelf(versionId)} />
export const PlanStatus = ({ id, status, label }: { id: number; status: 'active' | 'completed' | 'cancelled'; label: string }) => <ActionButton label={label} ghost confirm={`Yes, ${label.toLowerCase()}`} run={() => setPlanStatus(id, status)} />
export const TaskStep = ({ id, step, label }: { id: number; step: 'instructed' | 'practised'; label: string }) => <ActionButton label={label} ghost run={() => recordTaskStep(id, step)} />

// ---------------------------------------------------------------- culture
export function ContentItemForm({ sections }: { sections: string[] }) {
  const [title, setTitle] = useState('')
  const [section, setSection] = useState(sections[0] ?? '')
  const [pos, setPos] = useState('0')
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => saveContentItem(title, section, Number(pos))) }}>
      <p className="rowlabel">Add a topic</p>
      <Field label="Title" value={title} onChange={setTitle} placeholder="As it appears in your handbook" />
      <Field label="Section" value={section} onChange={setSection} placeholder="e.g. Background, Mission, Values, Conduct, Policy" />
      <Field label="Order" type="number" value={pos} onChange={setPos} />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Add topic</button>
    </form>
  )
}

export function ContentVersionForm({ contentId }: { contentId: number }) {
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(true)
  const { message, pending, go } = useAction()
  return (
    <form onSubmit={e => { e.preventDefault(); go(() => addContentVersion(contentId, url, ref, note, ack)) }} style={{ marginTop: 8 }}>
      <Field label="Drive link" value={url} onChange={setUrl} placeholder="https://drive.google.com/…" />
      <Field label="Page or heading in the file" value={ref} onChange={setRef} />
      <Field label="What changed (for a new version)" value={note} onChange={setNote} />
      <Check label="Staff must acknowledge it" value={ack} onChange={setAck} />
      <Msg text={message} />
      <button className="btn ghost" type="submit" disabled={pending} style={{ marginTop: 10 }}>Save as draft version</button>
    </form>
  )
}

export function FlagForm({ items }: { items: Opt[] }) {
  const [content, setContent] = useState('')
  const [kind, setKind] = useState('conflict')
  const [note, setNote] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => addFlag(content ? Number(content) : null, kind, note)) }}>
      <p className="rowlabel">Flag something for management review</p>
      <Select label="Topic" value={content} onChange={setContent} options={items} blank="General" />
      <Select label="Kind" value={kind} onChange={setKind} options={[{ value: 'conflict', label: 'Conflicts with another document' }, { value: 'duplicate', label: 'Duplicated' }, { value: 'unclear', label: 'Unclear or missing' }]} />
      <Area label="What needs review" value={note} onChange={setNote} />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Flag</button>
    </form>
  )
}

// ---------------------------------------------------------------- onboarding
export function TemplateForm({ departments }: { departments: string[] }) {
  const [name, setName] = useState('')
  const [dept, setDept] = useState('')
  const [position, setPosition] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => saveTemplate(name, dept, position), r => { if (r.ok && r.id) window.location.href = `/hr/onboarding?tab=templates&t=${r.id}` }) }}>
      <p className="rowlabel">New template</p>
      <Field label="Name" value={name} onChange={setName} placeholder="e.g. FOH crew" />
      <Select label="Department" value={dept} onChange={setDept} options={departments.map(d => ({ value: d, label: d }))} blank="Any" />
      <Field label="Position" value={position} onChange={setPosition} placeholder="Optional" />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Create template</button>
    </form>
  )
}

export function TemplateTaskForm({ templateId }: { templateId: number }) {
  const blank = { checkpoint: 'Day 1', day_offset: '0', title: '', instruction: '', source_url: '' }
  const [f, setF] = useState(blank)
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => addTemplateTask(templateId, f), r => { if (r.ok) setF({ ...blank, checkpoint: f.checkpoint, day_offset: f.day_offset }) }) }}>
      <p className="rowlabel">Add a task</p>
      <Field label="Checkpoint" value={f.checkpoint} onChange={set('checkpoint')} placeholder="Day 1, Day 2, Week 1, Day 30…" />
      <Field label="Due how many days after start" type="number" value={f.day_offset} onChange={set('day_offset')} />
      <Field label="Task" value={f.title} onChange={set('title')} />
      <Area label="Instruction" value={f.instruction} onChange={set('instruction')} placeholder="Use the wording from your SOP" />
      <Field label="Drive link (optional)" value={f.source_url} onChange={set('source_url')} />
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending || !f.title} style={{ marginTop: 12 }}>Add task</button>
    </form>
  )
}

export function StartPlanForm({ people, templates, today }: { people: Opt[]; templates: Opt[]; today: string }) {
  const [person, setPerson] = useState(people[0]?.value ?? '')
  const [tpl, setTpl] = useState(templates[0]?.value ?? '')
  const [start, setStart] = useState(today)
  const { message, pending, go } = useAction()
  if (!templates.length) return <p className="cap">Create a template with tasks first.</p>
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => startPlan(Number(person), Number(tpl), start), r => { if (r.ok && r.id) window.location.href = `/hr/onboarding/${r.id}` }) }}>
      <p className="rowlabel">Start onboarding</p>
      <Select label="New staff member" value={person} onChange={setPerson} options={people} />
      <Select label="Template" value={tpl} onChange={setTpl} options={templates} />
      <Field label="First day" type="date" value={start} onChange={setStart} />
      <p className="cap" style={gap}>Trainers stay blank until you choose to name them.</p>
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending || !person} style={{ marginTop: 12 }}>Start</button>
    </form>
  )
}

export function TrainersForm({ planId, primary, backup, logins }: { planId: number; primary: string; backup: string; logins: Opt[] }) {
  const [p, setP] = useState(primary)
  const [b, setB] = useState(backup)
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => setPlanTrainers(planId, p, b)) }}>
      <p className="rowlabel">Trainers (optional)</p>
      <Select label="Primary trainer" value={p} onChange={setP} options={logins} blank="None" />
      <Select label="Backup / support" value={b} onChange={setB} options={logins} blank="None" />
      <Msg text={message} />
      <button className="btn ghost" type="submit" disabled={pending} style={{ marginTop: 12 }}>Save trainers</button>
    </form>
  )
}

export function AssessForm({ taskId }: { taskId: number }) {
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState('competent')
  const [comment, setComment] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [due, setDue] = useState('')
  const { message, pending, go } = useAction()
  if (!open) return <button className="btn ghost" type="button" onClick={() => setOpen(true)}>Assess</button>
  return (
    <form onSubmit={e => { e.preventDefault(); go(() => recordTaskStep(taskId, 'assessed', { outcome, comment, follow_up: followUp, follow_up_due: due }), r => { if (r.ok) setOpen(false) }) }} style={{ marginTop: 8 }}>
      <Select label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'competent', label: 'Competent' }, { value: 'needs_follow_up', label: 'Needs follow-up' }, { value: 'not_yet', label: 'Not yet' }]} />
      <Field label="Comment" value={comment} onChange={setComment} />
      {outcome !== 'competent' ? <><Field label="Follow-up action" value={followUp} onChange={setFollowUp} /><Field label="Follow-up by" type="date" value={due} onChange={setDue} /></> : null}
      <Msg text={message} />
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button className="btn" type="submit" disabled={pending}>Save assessment</button>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

export function CommentForm({ taskId }: { taskId: number }) {
  const [text, setText] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form onSubmit={e => { e.preventDefault(); go(() => addTaskComment(taskId, text), r => { if (r.ok) setText('') }) }} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input className="login-input" placeholder="Add a comment" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn ghost" type="submit" disabled={pending || !text}>Add</button>
      <Msg text={message} />
    </form>
  )
}

// ---------------------------------------------------------------- training
const KINDS: Opt[] = [
  { value: 'sop', label: 'SOP' }, { value: 'pdf', label: 'PDF' }, { value: 'video', label: 'Video' },
  { value: 'text', label: 'Text lesson' }, { value: 'practical', label: 'Practical demonstration' },
]
export function CourseForm() {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('sop')
  const [desc, setDesc] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form className="admin-card" onSubmit={e => { e.preventDefault(); go(() => saveCourse(title, kind, desc)) }}>
      <p className="rowlabel">New course</p>
      <Field label="Title" value={title} onChange={setTitle} />
      <Select label="Type" value={kind} onChange={setKind} options={KINDS} />
      <Field label="Short description" value={desc} onChange={setDesc} />
      <p className="cap" style={gap}>Practical courses only count when a trainer signs them off.</p>
      <Msg text={message} />
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>Add course</button>
    </form>
  )
}

export function CourseVersionForm({ courseId }: { courseId: number }) {
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form onSubmit={e => { e.preventDefault(); go(() => addCourseVersion(courseId, url, body, note)) }} style={{ marginTop: 8 }}>
      <Field label="Drive link (SOP, PDF or video)" value={url} onChange={setUrl} />
      <Area label="…or the lesson text" value={body} onChange={setBody} />
      <Field label="What changed (for a new version)" value={note} onChange={setNote} />
      <Msg text={message} />
      <button className="btn ghost" type="submit" disabled={pending} style={{ marginTop: 10 }}>Publish new version</button>
    </form>
  )
}

export function AssignForm({ courseId, departments, people, hr }: { courseId: number; departments: string[]; people: Opt[]; hr: boolean }) {
  const [kind, setKind] = useState(hr ? 'everyone' : 'person')
  const [target, setTarget] = useState('')
  const [due, setDue] = useState('14')
  const [refresh, setRefresh] = useState('')
  const { message, pending, go } = useAction()
  const kinds: Opt[] = hr
    ? [{ value: 'everyone', label: 'Everyone' }, { value: 'department', label: 'A department' }, { value: 'position', label: 'A position' }, { value: 'person', label: 'One person' }]
    : [{ value: 'person', label: 'One person in my team' }]
  return (
    <form onSubmit={e => { e.preventDefault(); go(() => assignCourse(courseId, kind, target, Number(due), refresh ? Number(refresh) : null)) }} style={{ marginTop: 8 }}>
      <Select label="Assign to" value={kind} onChange={v => { setKind(v); setTarget('') }} options={kinds} />
      {kind === 'department' ? <Select label="Department" value={target} onChange={setTarget} options={departments.map(d => ({ value: d, label: d }))} blank="Pick…" /> : null}
      {kind === 'position' ? <Field label="Position" value={target} onChange={setTarget} placeholder="As written on profiles" /> : null}
      {kind === 'person' ? <Select label="Person" value={target} onChange={setTarget} options={people} blank="Pick…" /> : null}
      <Field label="Due within (days of joining or assignment)" type="number" value={due} onChange={setDue} />
      <Field label="Refresher every (months, optional)" type="number" value={refresh} onChange={setRefresh} />
      <Msg text={message} />
      <button className="btn ghost" type="submit" disabled={pending} style={{ marginTop: 10 }}>Assign</button>
    </form>
  )
}

export function SignOffForm({ personId, versionId }: { personId: number; versionId: number }) {
  const [note, setNote] = useState('')
  const { message, pending, go } = useAction()
  return (
    <form onSubmit={e => { e.preventDefault(); go(() => signOffTraining(personId, versionId, note)) }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input className="login-input" style={{ maxWidth: 220 }} placeholder="Evidence / note" value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn" type="submit" disabled={pending}>Sign off</button>
      <Msg text={message} />
    </form>
  )
}

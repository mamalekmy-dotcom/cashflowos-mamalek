import HRTabs from '../HRTabs'
import { AckContent, ContentItemForm, ContentVersionForm, FlagForm, PublishVersion, ResolveFlag } from '../LearningControls'
import { requireHRContext, trainees } from '@/lib/hr/guard'
import { cultureFor, stamp } from '@/lib/hr/learning'
import { isHR, teamOf } from '@/lib/hr/rules'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SECTIONS = ['Background', 'Founders', 'Mission', 'Vision', 'Principles', 'Values', 'Workplace conduct', 'Policy']

// Company & culture. Everyone reads what's published and acknowledges it. HR links
// each topic to its Drive file, drafts new versions and publishes them. The app
// never stores or rewrites the wording itself.
export default async function Culture() {
  const ctx = await requireHRContext()
  const hr = isHR(ctx.viewer)
  const published = await cultureFor(ctx.viewer.personId)
  const manager = hr || teamOf(ctx.viewer, ctx.people).size > 0
  const trainer = hr || (await trainees(ctx)).length > 0

  const admin = hr ? await Promise.all([
    supabase.from('hr_content').select('id, title, section, position').order('position').order('id'),
    supabase.from('hr_content_versions').select('id, content_id, version, source_url, source_ref, change_note, status, published_at').order('version', { ascending: false }),
    supabase.from('hr_acknowledgements').select('version_id'),
    supabase.from('hr_content_flags').select('id, content_id, kind, note, status, created_at').eq('status', 'open').order('created_at'),
    supabase.from('hr_people').select('id', { count: 'exact', head: true }).neq('employment_status', 'left'),
  ]) : null

  const bySection = SECTIONS.concat(published.map(p => p.item.section).filter(s => !SECTIONS.includes(s)))
    .map(s => ({ s, rows: published.filter(p => p.item.section === s) })).filter(g => g.rows.length)
  const toAck = published.filter(p => p.version.requires_ack && !p.acknowledgedAt).length

  return (
    <>
      <h1 className="ph">Company &amp; culture</h1>
      <p className="cap">Our background, values and policies, in our own words. {toAck ? `${toAck} to acknowledge.` : ''}</p>
      <HRTabs active="/hr/culture" hr={hr} manager={manager} trainer={trainer} />

      {bySection.length ? bySection.map(({ s, rows }) => (
        <div key={s}>
          <p className="rowlabel" style={{ marginTop: 14 }}>{s}</p>
          {rows.map(({ item, version, acknowledgedAt }) => (
            <div className="admin-card" key={item.id}>
              <p className="rowlabel" style={{ marginBottom: 2 }}>{item.title} <span className="cap">· v{version.version}</span></p>
              <p className="cap" style={{ margin: '0 0 8px' }}>
                <a href={version.source_url} target="_blank" rel="noreferrer">Open the document ↗</a>
                {version.source_ref ? ` · ${version.source_ref}` : ''}{version.change_note ? ` · Changed: ${version.change_note}` : ''}
              </p>
              {version.requires_ack
                ? acknowledgedAt ? <p className="cap" style={{ margin: 0 }}>✅ You acknowledged this on {stamp(acknowledgedAt)}</p>
                  : ctx.viewer.personId ? <AckContent versionId={version.id} /> : null
                : null}
            </div>
          ))}
        </div>
      )) : <div className="empty"><p>Nothing published yet. HR adds each topic with a link to its Drive file.</p></div>}

      {admin ? (() => {
        const [{ data: items }, { data: versions }, { data: acks }, { data: flags }, { count: staff }] = admin
        const ackCount = (id: number) => (acks ?? []).filter(a => a.version_id === id).length
        return (
          <>
            <h2 className="rowlabel" style={{ marginTop: 24 }}>Manage (HR)</h2>
            <p className="cap">Use only approved wording. A new version asks everyone to acknowledge again; earlier acknowledgements stay on record.</p>
            {(items ?? []).map(item => {
              const vs = (versions ?? []).filter(v => v.content_id === item.id)
              return (
                <details className="admin-card" key={item.id}>
                  <summary className="rowlabel">{item.section} · {item.title} · {vs.length} version{vs.length === 1 ? '' : 's'}</summary>
                  {vs.map(v => (
                    <div key={v.id} style={{ margin: '8px 0' }}>
                      <p className="cap" style={{ margin: 0 }}>
                        v{v.version} · {v.status}{v.status === 'published' ? ` · ${ackCount(v.id)}/${staff ?? 0} acknowledged` : ''} · <a href={v.source_url} target="_blank" rel="noreferrer">file ↗</a>
                      </p>
                      {v.status === 'draft' ? <PublishVersion versionId={v.id} /> : null}
                    </div>
                  ))}
                  <ContentVersionForm contentId={item.id} />
                </details>
              )
            })}
            <ContentItemForm sections={SECTIONS} />

            <h2 className="rowlabel" style={{ marginTop: 20 }}>For management review</h2>
            {flags?.length ? flags.map(f => (
              <div className="admin-card" key={f.id}>
                <p className="cap" style={{ margin: 0 }}>{f.kind} · {(items ?? []).find(i => i.id === f.content_id)?.title ?? 'General'} · {f.created_at.slice(0, 10)}</p>
                <p style={{ margin: '4px 0 8px' }}>{f.note}</p>
                <ResolveFlag id={f.id} />
              </div>
            )) : <p className="cap">Nothing flagged.</p>}
            <FlagForm items={(items ?? []).map(i => ({ value: String(i.id), label: i.title }))} />
          </>
        )
      })() : null}
    </>
  )
}

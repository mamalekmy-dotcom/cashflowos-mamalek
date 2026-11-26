import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { cabinet, FOLDERS, folderLabel, myFiles, UPLOAD_FOLDERS, type CabinetFile } from '@/lib/doc-center'
import { hasPin, isUnlocked } from './actions'
import { PinForm, ReviewDoc, type DocRow } from './DocForms'
import DocUpload from './DocUpload'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNED_URL_SECONDS = 600
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const ymShift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }
const dayText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const uploadFolders = UPLOAD_FOLDERS.map(f => ({ key: f.key, label: f.label }))

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from('vault').createSignedUrl(path, SIGNED_URL_SECONDS)
  return data?.signedUrl ?? null
}

function FileRow({ f, showFolder }: { f: CabinetFile; showFolder: boolean }) {
  const open = f.url || f.drive
  return (
    <div className="doc-row">
      {open ? (
        <a href={open} target="_blank" rel="noreferrer" className="doc-thumb" aria-label={`Open ${f.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {f.isImage && f.url ? <img src={f.url} alt="" /> : <span>📄</span>}
        </a>
      ) : <span className="doc-thumb"><span>📄</span></span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="doc-title">{f.title}</p>
        <p className="cap" style={{ margin: 0 }}>
          {showFolder ? `${folderLabel(f.folder)} · ` : ''}{dayText(f.date)}{f.by ? ` · by ${f.by}` : ''}
          {f.status === 'new' ? <span className="pill overdue" style={{ marginLeft: 6 }}>waiting</span> : null}
          {f.drive ? <> · <a href={f.drive} target="_blank" rel="noreferrer">Drive</a></> : null}
        </p>
      </div>
      <span className="doc-amt">{f.amount != null ? rm(f.amount) : ''}</span>
    </div>
  )
}

export default async function DocCenter({ searchParams }: { searchParams: Promise<{ m?: string; f?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const today = todayISO()

  // Ticked staff: their own files only.
  if (user.role !== 'owner') {
    const mine = await myFiles(user.id)
    return (
      <div className="doc-page">
        <h1 className="ph">My documents</h1>
        <p className="cap">Only the files you added. The owner sees the full cabinet.</p>
        <DocUpload folders={uploadFolders} today={today} />
        <section className="card">
          <p className="card-title">Your files</p>
          {mine.length ? mine.map(f => <FileRow key={f.id} f={f} showFolder />) : <p className="cap">Nothing filed yet. Snap your first document above.</p>}
        </section>
      </div>
    )
  }

  if (!(await isUnlocked())) {
    return (
      <>
        <h1 className="ph">Doc Center</h1>
        <p className="cap">Team only see their own files. This PIN protects the full cabinet.</p>
        <PinForm firstTime={!(await hasPin())} />
      </>
    )
  }

  const sp = await searchParams
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7)
  const pick = FOLDERS.some(f => f.key === sp.f) ? sp.f! : ''
  const [files, waitingRows] = await Promise.all([
    cabinet(month),
    supabase.from('documents').select('id, kind, merchant, note, amount, doc_date, storage_path, app_users!documents_created_by_fkey(name)')
      .eq('status', 'new').order('created_at', { ascending: false }).limit(50),
  ])
  const waiting: DocRow[] = await Promise.all((waitingRows.data ?? []).map(async r => ({
    id: r.id, kind: r.kind, merchant: r.merchant, note: r.note, amount: r.amount, doc_date: r.doc_date,
    url: await signed(r.storage_path), by: (r.app_users as unknown as { name: string } | null)?.name ?? 'Unknown',
  })))

  const inFolder = (k: string) => files.filter(f => f.folder === k)
  const filled = FOLDERS.filter(f => inFolder(f.key).length).length
  const shown = pick ? inFolder(pick) : files
  const href = (m: string, f = pick) => `/docs?m=${m}${f ? `&f=${f}` : ''}`

  return (
    <div className="doc-page">
      <h1 className="ph">Doc Center</h1>

      {waiting.length ? (
        <section className="card attention">
          <p className="card-title">Waiting for you · {waiting.length}</p>
          <p className="cap" style={{ marginTop: 0 }}>Claims and receipts. Accept turns them into a cost.</p>
          {waiting.map(doc => <ReviewDoc key={doc.id} doc={doc} today={today} />)}
        </section>
      ) : null}

      <section className="card">
        <div className="doc-month">
          <Link href={href(ymShift(month, -1))} aria-label="Previous month">‹</Link>
          <strong>{monthLabel(month)}</strong>
          {month < today.slice(0, 7) ? <Link href={href(ymShift(month, 1))} aria-label="Next month">›</Link> : <span />}
          <span className="cap" style={{ marginLeft: 'auto' }}>{filled} of {FOLDERS.length} folders filled · {files.length} files</span>
        </div>
        <div className="doc-folders">
          {FOLDERS.map(f => {
            const list = inFolder(f.key)
            const total = list.reduce((s, x) => s + (x.amount ?? 0), 0)
            return (
              <Link key={f.key} href={href(month, pick === f.key ? '' : f.key)} className={`doc-folder${list.length ? '' : ' empty'}${pick === f.key ? ' on' : ''}`}>
                <strong>{f.label}</strong>
                <span>{list.length ? `${list.length}${total ? ` · ${rm(total)}` : ''}` : 'empty'}</span>
              </Link>
            )
          })}
        </div>
        <div className="chips" style={{ margin: '12px 0 4px' }}>
          <Link href={href(month, '')} className={`chip${pick ? '' : ' on'}`}>All</Link>
          {pick ? <span className="chip on">{folderLabel(pick)}</span> : null}
        </div>
        {shown.length ? shown.map(f => <FileRow key={f.id} f={f} showFolder={!pick} />)
          : <p className="cap">Nothing filed {pick ? `in ${folderLabel(pick)} ` : ''}this month. Approved supplier bills land in Supplier by themselves.</p>}
        <p className="cap" style={{ marginTop: 10 }}>Tap a file to open it. Also in Drive: STOCK COUNT › Doc Center {month.slice(0, 4)} › folder › month (supplier bills: Suppliers Invoices).</p>
      </section>

      <DocUpload folders={uploadFolders} today={today} />
    </div>
  )
}

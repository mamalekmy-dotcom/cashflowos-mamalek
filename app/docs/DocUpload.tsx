'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fingerprint, pagesToPdf, type Page } from '../scan/scanner'
import { addDocument } from './file-actions'

type Folder = { key: string; label: string }
const SIDE = 1800

// A photo as an upright JPEG page, at most 1800 px on its longest side.
async function toPage(file: File): Promise<Page> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  const scale = Math.min(1, SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.82))
  if (!blob) throw new Error('Could not read that photo.')
  return { blob, w: c.width, h: c.height, preview: URL.createObjectURL(blob) }
}

// Staff and owners file a document: pick the folder, snap or add pages (joined into one
// PDF), add a note. Date and amount are optional: the AI fills them from the first page.
export default function DocUpload({ folders, today }: { folders: Folder[]; today: string }) {
  const router = useRouter()
  const [folder, setFolder] = useState('')
  const [pages, setPages] = useState<Page[]>([])
  const [pdf, setPdf] = useState<File | null>(null)
  const [originals, setOriginals] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, start] = useTransition()
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  async function add(list: FileList | null) {
    if (!list?.length) return
    setMessage('')
    const files = Array.from(list).slice(0, 10)
    const onePdf = files.find(f => f.type === 'application/pdf')
    if (onePdf) { setPdf(onePdf); setPages([]); setOriginals([onePdf]); return }
    setBusy(true)
    try {
      const made = await Promise.all(files.filter(f => f.type.startsWith('image/')).map(toPage))
      setPdf(null)
      setPages(p => [...p, ...made].slice(0, 10))
      setOriginals(o => [...o, ...files].slice(0, 10))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that photo.')
    } finally { setBusy(false) }
  }

  function reset() {
    setPages([]); setPdf(null); setOriginals([]); setNote(''); setDate(''); setAmount('')
  }

  function save() {
    if (!folder) return setMessage('Pick what it is first.')
    if (!pdf && !pages.length) return setMessage('Take a photo or add a file first.')
    start(async () => {
      const form = new FormData()
      form.append('folder', folder)
      if (pdf) form.append('file', pdf)
      else if (pages.length === 1) form.append('file', new File([pages[0].blob], 'page.jpg', { type: 'image/jpeg' }))
      else form.append('file', new File([await pagesToPdf(pages)], 'document.pdf', { type: 'application/pdf' }))
      if (pages[0]) form.append('peek', new File([pages[0].blob], 'peek.jpg', { type: 'image/jpeg' }))
      form.append('hash', await fingerprint(originals).catch(() => ''))
      form.append('note', note)
      form.append('date', date)
      form.append('amount', amount)
      const r = await addDocument(form)
      setMessage(r.message)
      if (r.ok) { reset(); router.refresh() }
    })
  }

  return (
    <section className="card doc-add">
      <p className="card-title">Add a document</p>
      <p className="rowlabel" style={{ margin: '0 0 6px' }}>What is it?</p>
      <div className="chips">
        {folders.map(f => (
          <button key={f.key} type="button" className={`chip${folder === f.key ? ' on' : ''}`} onClick={() => setFolder(f.key)}>{f.label}</button>
        ))}
      </div>
      <p className="cap" style={{ margin: '6px 0 10px' }}>Supplier bills still go through Scan, as now.</p>

      <div className="btnrow">
        <button type="button" className="btn ghost" disabled={busy || pending} onClick={() => camera.current?.click()}>📷 Camera</button>
        <button type="button" className="btn ghost" disabled={busy || pending} onClick={() => picker.current?.click()}>⬆ Add files</button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { void add(e.target.files); e.target.value = '' }} />
        <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => { void add(e.target.files); e.target.value = '' }} />
      </div>

      {pages.length || pdf ? (
        <div className="doc-pages">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pages.map((p, i) => <img key={i} src={p.preview} alt={`Page ${i + 1}`} />)}
          {pdf ? <span className="doc-pdf">PDF</span> : null}
          <span className="cap">{pdf ? pdf.name : `${pages.length} page${pages.length > 1 ? 's' : ''}${pages.length > 1 ? ', one PDF' : ''}`}</span>
          <button type="button" className="btn ghost" onClick={reset} style={{ marginLeft: 'auto' }}>Clear</button>
        </div>
      ) : null}
      {busy ? <p className="cap">Reading photos…</p> : null}

      <input className="login-input" placeholder="Note, e.g. TNB bill October" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 10 }} />
      <div className="doc-two">
        <input className="login-input" type="date" max={today} aria-label="Date" value={date} onChange={e => setDate(e.target.value)} />
        <input className="login-input" inputMode="decimal" placeholder="Amount RM" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <p className="cap" style={{ margin: '6px 0 0' }}>Leave date and amount blank and the AI reads them. Claims go to the owners to approve and pay back.</p>
      {message ? <p className={message.startsWith('Filed') || message.startsWith('Claim sent') ? 'cap' : 'login-error'} style={{ marginTop: 8 }}>{message}</p> : null}
      <button type="button" className="btn" disabled={pending || busy} onClick={save} style={{ marginTop: 10, width: '100%' }}>{pending ? 'Saving…' : 'Save'}</button>
    </section>
  )
}

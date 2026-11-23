'use client'
import { useRef, useState } from 'react'
import { scanDocument } from './actions'
import { fingerprint, findCorners, loadPhoto, pagesToPdf, scanPage, warmScanner, type Page, type Pt } from './scanner'
import CropScreen from './CropScreen'

const MAX_BILLS = 10
const MAX_PAGES = 10
type Bill = { id: string; pages: Page[]; pdf?: File; originals: File[]; result?: string; ok?: boolean }
type Crop = { photo: HTMLCanvasElement; corners: Pt[]; found: boolean; file: File; target: string | null }

let scannerLoaded = false
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Up to 10 bills at once. Every photo (camera or gallery) gets the crop screen: the
// scanner finds the bill's corners, staff fix them if needed, and the page is
// straightened and cleaned to black and white in the phone. "+ Page" adds pages to the
// same bill; a bill with several pages is sent as one PDF. Bills are sent one by one.
export default function BillScanner() {
  const [bills, setBills] = useState<Bill[]>([])
  const [crop, setCrop] = useState<Crop | null>(null)
  const [cropBusy, setCropBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [note, setNote] = useState('')
  const queue = useRef<{ file: File; target: string | null }[]>([])
  const cropping = useRef(false)
  const target = useRef<string | null>(null)
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const waiting = bills.filter(b => b.result === undefined)
  const full = waiting.length >= MAX_BILLS

  const nextPhoto = async () => {
    const job = queue.current.shift()
    if (!job) {
      cropping.current = false
      setCrop(null)
      setProgress('')
      return
    }
    cropping.current = true
    setProgress(scannerLoaded ? 'Finding the edges…' : 'Getting the scanner ready (first time only)…')
    try {
      const photo = await loadPhoto(job.file)
      const { corners, found } = await findCorners(photo)
      scannerLoaded = true
      setProgress('')
      setCrop({ photo, corners, found, file: job.file, target: job.target })
    } catch {
      setNote('Could not open that photo. Try another.')
      void nextPhoto()
    }
  }

  const addPage = (page: Page, file: File, to: string | null) => {
    setBills(list => {
      const open = list.filter(b => b.result === undefined)
      if (to && open.some(b => b.id === to)) {
        return open.map(b => (b.id === to && b.pages.length < MAX_PAGES ? { ...b, pages: [...b.pages, page], originals: [...b.originals, file] } : b))
      }
      return [...open, { id: newId(), pages: [page], originals: [file] }]
    })
  }

  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    const to = target.current
    setNote('')
    let room = to ? Number.POSITIVE_INFINITY : MAX_BILLS - waiting.length - queue.current.length
    let skipped = false
    const pdfs: Bill[] = []
    for (const f of files) {
      if (room <= 0) { skipped = true; continue }
      if (f.type === 'application/pdf') pdfs.push({ id: newId(), pages: [], pdf: f, originals: [f] })
      else queue.current.push({ file: f, target: to })
      room--
    }
    if (skipped) setNote(`Only ${MAX_BILLS} bills at a time, so some were left out.`)
    if (pdfs.length) setBills(list => [...list.filter(b => b.result === undefined), ...pdfs])
    if (!cropping.current) void nextPhoto()
  }

  const open = (input: React.RefObject<HTMLInputElement | null>, to: string | null) => {
    target.current = to
    warmScanner()
    input.current?.click()
  }

  const useCrop = async (corners: Pt[] | null) => {
    if (!crop) return
    setCropBusy(true)
    try {
      const w = crop.photo.width, h = crop.photo.height
      const page = await scanPage(crop.photo, corners ?? [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }])
      addPage(page, crop.file, crop.target)
    } catch {
      setNote('Could not scan that photo. Try again.')
    }
    setCropBusy(false)
    setCrop(null)
    void nextPhoto()
  }

  const sendAll = async () => {
    const list = bills.filter(b => b.result === undefined)
    setBusy(true)
    setNote('')
    for (let k = 0; k < list.length; k++) {
      const b = list[k]
      setProgress(`Reading ${k + 1} of ${list.length}…`)
      let res: { ok: boolean; message: string }
      try {
        const file = b.pdf
          ? b.pdf
          : b.pages.length > 1
            ? new File([await pagesToPdf(b.pages)], 'bill.pdf', { type: 'application/pdf' })
            : new File([b.pages[0].blob], 'bill.jpg', { type: 'image/jpeg' })
        const form = new FormData()
        form.append('file', file)
        form.append('hash', await fingerprint(b.originals))
        res = await scanDocument(form)
      } catch {
        res = { ok: false, message: 'Could not send. Check the connection and try again.' }
      }
      setBills(all => all.map(x => (x.id === b.id ? { ...x, result: res.message, ok: res.ok } : x)))
    }
    setProgress('')
    setBusy(false)
  }

  const lock = busy || !!crop || cropBusy

  return (
    <div className="admin-card">
      <p className="rowlabel">Scan documents</p>
      <p className="cap" style={{ margin: '0 0 10px' }}>
        Up to {MAX_BILLS} bills at once. Each photo is cropped to the bill and cleaned to black and white. A bill with more pages: tap &quot;+ Page&quot;.
      </p>
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={picked} />
      <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={picked} />
      <div className="btnrow" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={lock || full} onClick={() => open(camera, null)}>📷 {waiting.length ? 'Next bill' : 'Take photo'}</button>
        <button type="button" className="btn ghost" disabled={lock || full} onClick={() => open(gallery, null)}>📁 Choose files or photos</button>
      </div>

      {bills.length ? (
        <div className="scan-tray">
          {bills.map((b, k) => (
            <div key={b.id} className={`scan-item${b.result === undefined ? '' : b.ok ? ' done' : ' bad'}`}>
              {b.pages[0] ? <img src={b.pages[0].preview} alt={`Bill ${k + 1}`} /> : <span className="scan-pdf">PDF</span>}
              {b.pages.length > 1 ? <span className="scan-count">{b.pages.length} pages</span> : null}
              {b.result === undefined ? (
                <>
                  <button type="button" className="scan-x" aria-label="Remove" disabled={lock} onClick={() => setBills(l => l.filter(x => x.id !== b.id))}>×</button>
                  {!b.pdf && b.pages.length < MAX_PAGES
                    ? <button type="button" className="btn ghost scan-add" disabled={lock} onClick={() => open(gallery, b.id)}>+ Page</button>
                    : null}
                </>
              ) : <p className="cap">{b.ok ? '✅' : '⚠️'} {b.result}</p>}
            </div>
          ))}
        </div>
      ) : null}

      {waiting.length ? (
        <button type="button" className="btn" disabled={lock} onClick={sendAll} style={{ marginTop: 12, width: '100%' }}>
          Send {waiting.length} {waiting.length === 1 ? 'bill' : 'bills'}
        </button>
      ) : null}
      {progress ? <p className="cap" style={{ margin: '10px 0 0' }}>{progress}</p> : null}
      {note ? <p className="cap" style={{ margin: '10px 0 0' }}>{note}</p> : null}

      {crop ? (
        <CropScreen photo={crop.photo} corners={crop.corners} found={crop.found} busy={cropBusy}
          onDone={c => void useCrop(c)} onSkip={() => void useCrop(null)}
          onCancel={() => { setCrop(null); void nextPhoto() }} />
      ) : null}
    </div>
  )
}

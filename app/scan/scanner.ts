// The in-phone scanner: load a photo, find the bill's 4 corners (OpenCV, loaded once
// on first use and cached by the browser), straighten it, clean it to black and white
// (lib/scan-filter.ts), and join pages into one PDF. Everything here runs in the browser.

import { flattenAndStretch } from '@/lib/scan-filter'

export type Pt = { x: number; y: number }
export type Page = { blob: Blob; w: number; h: number; preview: string }

const MAX_SIDE = 2400 // working size for the photo
const OUT_SIDE = 2000 // longest side of the finished scan
const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js'

// The photo as a canvas, upright, at most MAX_SIDE on its longest side.
export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bitmap.width * scale)
  c.height = Math.round(bitmap.height * scale)
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height)
  bitmap.close?.()
  return c
}

let cvReady: Promise<any> | null = null
function loadCv(): Promise<any> {
  if (cvReady) return cvReady
  cvReady = new Promise((resolve, reject) => {
    const w = window as any
    const done = async () => {
      let cv = w.cv
      if (cv && typeof cv.then === 'function') cv = await cv
      if (cv?.Mat) return resolve(cv)
      if (cv) cv.onRuntimeInitialized = () => resolve(cv)
    }
    if (w.cv) return void done()
    const s = document.createElement('script')
    s.src = OPENCV_URL
    s.async = true
    s.onload = () => void done()
    s.onerror = () => reject(new Error('scanner did not load'))
    document.head.appendChild(s)
    setTimeout(() => reject(new Error('scanner took too long')), 45_000)
  }).catch(e => {
    cvReady = null
    throw e
  })
  return cvReady
}
export const warmScanner = () => { loadCv().catch(() => {}) }

const inset = (w: number, h: number): Pt[] => {
  const dx = w * 0.04, dy = h * 0.04
  return [{ x: dx, y: dy }, { x: w - dx, y: dy }, { x: w - dx, y: h - dy }, { x: dx, y: h - dy }]
}

// Top-left, top-right, bottom-right, bottom-left.
function order(pts: Pt[]): Pt[] {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x))
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]]
}

// The bill's corners in the photo. Falls back to a frame just inside the photo when the
// scanner can't load or can't find a clear page edge; staff drag the corners either way.
export async function findCorners(photo: HTMLCanvasElement): Promise<{ corners: Pt[]; found: boolean }> {
  const W = photo.width, H = photo.height
  try {
    const cv = await loadCv()
    const scale = Math.min(1, 800 / Math.max(W, H))
    const small = document.createElement('canvas')
    small.width = Math.round(W * scale)
    small.height = Math.round(H * scale)
    small.getContext('2d')!.drawImage(photo, 0, 0, small.width, small.height)
    const src = cv.imread(small)
    const gray = new cv.Mat(), edges = new cv.Mat(), contours = new cv.MatVector(), hier = new cv.Mat()
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
      cv.Canny(gray, edges, 50, 150)
      const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
      cv.dilate(edges, edges, k)
      k.delete()
      cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const minArea = small.width * small.height * 0.2
      let best: Pt[] | null = null
      let bestArea = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        const area = cv.contourArea(c)
        if (area > minArea && area > bestArea) {
          const approx = new cv.Mat()
          cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true)
          if (approx.rows === 4) {
            const pts: Pt[] = []
            for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2] / scale, y: approx.data32S[j * 2 + 1] / scale })
            best = pts
            bestArea = area
          }
          approx.delete()
        }
        c.delete()
      }
      return best ? { corners: order(best), found: true } : { corners: inset(W, H), found: false }
    } finally {
      src.delete(); gray.delete(); edges.delete(); contours.delete(); hier.delete()
    }
  } catch {
    return { corners: inset(W, H), found: false }
  }
}

// The homography that maps the unit square's corners onto quad (TL, TR, BR, BL).
function squareToQuad(q: Pt[]) {
  const [p0, p1, p2, p3] = q
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return { a: p1.x - p0.x, b: p2.x - p1.x, c: p0.x, d: p1.y - p0.y, e: p2.y - p1.y, f: p0.y, g: 0, h: 0 }
  }
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y
  const den = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  return { a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x, d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y, g, h }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

// Straighten the quad into a flat page, clean it, and return it as a JPEG page.
export async function scanPage(photo: HTMLCanvasElement, corners: Pt[]): Promise<Page> {
  const [tl, tr, br, bl] = corners
  let ow = Math.max(dist(tl, tr), dist(bl, br))
  let oh = Math.max(dist(tl, bl), dist(tr, br))
  const s = Math.min(1, OUT_SIDE / Math.max(ow, oh))
  ow = Math.max(50, Math.round(ow * s))
  oh = Math.max(50, Math.round(oh * s))

  const sw = photo.width, sh = photo.height
  const src = photo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sw, sh).data
  const grey = new Uint8ClampedArray(sw * sh)
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) grey[p] = (src[i] * 299 + src[i + 1] * 587 + src[i + 2] * 114) / 1000

  const m = squareToQuad([tl, tr, br, bl])
  const flat = new Uint8ClampedArray(ow * oh)
  for (let y = 0; y < oh; y++) {
    const v = (y + 0.5) / oh
    for (let x = 0; x < ow; x++) {
      const u = (x + 0.5) / ow
      const z = m.g * u + m.h * v + 1
      const fx = (m.a * u + m.b * v + m.c) / z
      const fy = (m.d * u + m.e * v + m.f) / z
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(fx)))
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(fy)))
      const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0))
      const i0 = y0 * sw + x0
      const top = grey[i0] * (1 - ax) + grey[i0 + 1] * ax
      const bot = grey[i0 + sw] * (1 - ax) + grey[i0 + sw + 1] * ax
      flat[y * ow + x] = top * (1 - ay) + bot * ay
    }
  }
  const clean = flattenAndStretch(flat, ow, oh)

  const out = document.createElement('canvas')
  out.width = ow
  out.height = oh
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(ow, oh)
  for (let p = 0, i = 0; p < clean.length; p++, i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = clean[p]
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob(b => (b ? resolve(b) : reject(new Error('scan failed'))), 'image/jpeg', 0.85))
  return { blob, w: ow, h: oh, preview: URL.createObjectURL(blob) }
}

// A fingerprint of the original photos, so the exact same ones sent again are caught.
export async function fingerprint(files: File[]): Promise<string> {
  const parts: string[] = []
  for (const f of files) {
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
    parts.push(Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''))
  }
  const all = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')))
  return Array.from(new Uint8Array(all)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Several JPEG pages as one PDF (A4 width), built by hand: one image per page.
export async function pagesToPdf(pages: Page[]): Promise<Blob> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const put = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b
    chunks.push(bytes)
    size += bytes.length
  }
  const obj = (n: number) => { offsets[n] = size; put(`${n} 0 obj\n`) }

  put('%PDF-1.4\n')
  const n = pages.length
  const pageNo = (i: number) => 3 + i * 3
  obj(1); put('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  obj(2); put(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`)
  for (let i = 0; i < n; i++) {
    const p = pages[i]
    const jpeg = new Uint8Array(await p.blob.arrayBuffer())
    const W = 595, H = Math.round((p.h / p.w) * 595)
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`
    obj(pageNo(i))
    put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${pageNo(i) + 1} 0 R >> >> /Contents ${pageNo(i) + 2} 0 R >>\nendobj\n`)
    obj(pageNo(i) + 1)
    put(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    put(jpeg)
    put('\nendstream\nendobj\n')
    obj(pageNo(i) + 2)
    put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  }
  const total = 3 + n * 3
  const xref = size
  put(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let k = 1; k < total; k++) put(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

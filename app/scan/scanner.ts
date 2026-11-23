// Turns a phone photo of a bill into a "scanned" page before it's sent: upright, sized
// for reading (longest side 2000 px), black and white, with shadows and grey paper
// lifted to white and faint ink pushed to black. Runs in the browser, so no extra
// upload or download. PDFs and anything that fails go through unchanged.

const MAX_SIDE = 2000

export async function toScan(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    const n = w * h
    const grey = new Uint8ClampedArray(n)
    for (let i = 0, p = 0; p < n; i += 4, p++) grey[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000

    // Uneven light (a shadow across the bill): divide by a blurred copy, so each part
    // of the page is judged against its own paper colour.
    const bg = boxBlur(grey, w, h, Math.max(8, Math.round(Math.max(w, h) / 40)))
    const flat = new Uint8ClampedArray(n)
    for (let p = 0; p < n; p++) flat[p] = Math.min(255, (grey[p] / Math.max(1, bg[p])) * 235)

    // Stretch contrast: the darkest 1% becomes black, the lightest 30% (the paper) white.
    const hist = new Uint32Array(256)
    for (let p = 0; p < n; p++) hist[flat[p]]++
    const at = (q: number) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= q * n) return v } return 255 }
    const lo = at(0.01)
    const hi = Math.max(lo + 1, at(0.7))
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      const v = Math.max(0, Math.min(255, ((flat[p] - lo) * 255) / (hi - lo)))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(img, 0, 0)

    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '-scan.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// A fast box blur (two passes of running sums), radius r.
function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Float32Array(w * h)
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0
    const row = y * w
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1)
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1)
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

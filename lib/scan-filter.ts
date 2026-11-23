// The "scanner" maths, shared by the phone (app/scan/scanner.ts) and the server
// (lib/clean-image.ts). Takes one grey value per pixel and returns the cleaned page:
// each pixel judged against its own neighbourhood's paper colour (so a shadow across
// the bill disappears), then the darkest 1% made black and the lightest 30% white.

export function flattenAndStretch(grey: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h
  const bg = boxBlur(grey, w, h, Math.max(8, Math.round(Math.max(w, h) / 40)))
  const flat = new Uint8ClampedArray(n)
  for (let p = 0; p < n; p++) flat[p] = Math.min(255, (grey[p] / Math.max(1, bg[p])) * 235)

  const hist = new Uint32Array(256)
  for (let p = 0; p < n; p++) hist[flat[p]]++
  const at = (q: number) => {
    let c = 0
    for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= q * n) return v }
    return 255
  }
  const lo = at(0.01)
  const hi = Math.max(lo + 1, at(0.7))
  const out = new Uint8ClampedArray(n)
  for (let p = 0; p < n; p++) out[p] = ((flat[p] - lo) * 255) / (hi - lo)
  return out
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

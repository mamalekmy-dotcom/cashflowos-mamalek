import 'server-only'
import { flattenAndStretch } from './scan-filter'

// A bill photo sent on Telegram, cleaned like the app's scanner: upright, longest side
// 2000 px, black and white, shadows lifted, paper white and ink black (scan-filter.ts,
// the same maths the phone runs). PDFs and anything sharp can't read go through unchanged.
export async function cleanBillPhoto(bytes: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!mime.startsWith('image/')) return { bytes, mime }
  try {
    const sharp = (await import('sharp')).default
    const { data, info } = await sharp(bytes)
      .rotate()
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const grey = new Uint8ClampedArray(data.buffer, data.byteOffset, info.width * info.height)
    const out = flattenAndStretch(grey, info.width, info.height)
    const jpeg = await sharp(Buffer.from(out.buffer), { raw: { width: info.width, height: info.height, channels: 1 } })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { bytes: jpeg, mime: 'image/jpeg' }
  } catch (e) {
    console.error('[CFO] clean photo failed, using the original:', e)
    return { bytes, mime }
  }
}

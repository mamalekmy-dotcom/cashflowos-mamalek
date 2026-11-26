'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { accessLevel } from '@/lib/access'
import { supabase } from '@/lib/supabase'
import { readImage } from '@/lib/vision'
import { duplicateNote, rememberFile, seenBefore } from '@/lib/seen-files'
import { saveDocFile, stockConfigured } from '@/lib/stock-sheet'
import { UPLOAD_FOLDERS } from '@/lib/doc-center'

type Result = { ok: boolean; message: string }
const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const asDate = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)

// File one document (photos joined into one PDF on the phone). Owners, and staff with
// the Doc Center tab ticked. A claim waits for an owner to accept it (then it's a cost);
// everything else is just filed. The AI reads the date and amount when they're left blank.
export async function addDocument(form: FormData): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: 'Please log in again.' }
  if (user.role !== 'owner' && !accessLevel(user, '/docs')) return { ok: false, message: 'Ask an owner to tick Doc Center for you in Admin.' }

  const folder = String(form.get('folder') || '')
  const f = UPLOAD_FOLDERS.find(x => x.key === folder)
  if (!f) return { ok: false, message: 'Pick what it is first.' }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Take a photo or choose a file.' }
  if (file.size > MAX_BYTES) return { ok: false, message: 'That file is over 12 MB. Send fewer pages.' }
  if (!ALLOWED.has(file.type)) return { ok: false, message: 'Use a photo or PDF.' }

  const hash = String(form.get('hash') || '').replace(/[^a-f0-9]/g, '').slice(0, 64)
  const seenKey = hash.length === 64 ? `doc:${hash}` : ''
  const seen = await seenBefore(seenKey)
  if (seen) return { ok: false, message: duplicateNote(seen).replace(/^📁 /, '') }

  let title = String(form.get('note') || '').trim().slice(0, 120)
  let date = asDate(form.get('date'))
  const typed = Number(String(form.get('amount') || '').replace(/[^\d.]/g, ''))
  let amount: number | null = Number.isFinite(typed) && typed > 0 ? Math.round(typed * 100) / 100 : null

  // The first page as a photo, for the AI to read what was left blank.
  const peek = form.get('peek')
  if ((!date || amount === null || !title) && peek instanceof File && peek.size > 0 && peek.size < MAX_BYTES) {
    const read = await readImage(Buffer.from(await peek.arrayBuffer()).toString('base64'), peek.type || 'image/jpeg').catch(() => null)
    if (read) {
      date = date ?? asDate(read.date)
      if (amount === null && typeof read.amount === 'number' && read.amount > 0) amount = read.amount
      if (!title && read.merchant) title = read.merchant.slice(0, 120)
    }
  }
  if (!title) title = f.label

  const bytes = Buffer.from(await file.arrayBuffer())
  const path = `docs/${randomUUID()}`
  const { error: upErr } = await supabase.storage.from('vault').upload(path, bytes, { contentType: file.type })
  if (upErr) return { ok: false, message: 'Could not save the file. Try again.' }

  let drive: { fileId: string; link: string } | null = null
  if (stockConfigured()) {
    drive = await saveDocFile({
      photo: { base64: bytes.toString('base64'), mime: file.type }, date: date ?? '', folder: f.drive, title, total: amount,
    }).catch(e => { console.error('[CFO] Doc Center to Drive failed:', e); return null })
  }

  const claim = f.key === 'claim'
  const { error } = await supabase.from('documents').insert({
    kind: claim ? 'claim' : 'other', category: f.key, status: claim ? 'new' : 'filed', title, note: title,
    merchant: claim ? null : title, doc_date: date, amount, storage_path: path, mime: file.type,
    drive_id: drive?.fileId ?? null, drive_link: drive?.link ?? null, created_by: user.id,
  })
  if (error) return { ok: false, message: error.message }
  await rememberFile(seenKey, `${title}${amount ? ` RM ${amount}` : ''}`, user.name)
  revalidatePath('/docs')
  const where = drive ? ' Saved to Drive too.' : ''
  return { ok: true, message: claim ? `Claim sent to the owners${amount ? ` (RM ${amount.toFixed(2)})` : ''}.${where}` : `Filed in ${f.label}.${where}` }
}

'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { readImage } from '@/lib/vision'

type Result = { ok: boolean; message: string }

const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const asDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)

// Anyone logged in can scan. Nothing reaches the P&L until an owner accepts it in
// Doc Center. PDFs are stored without being read, so an owner types their details.
export async function scanDocument(form: FormData): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: 'Please log in again.' }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Take a photo or choose a file.' }
  if (file.size > MAX_BYTES) return { ok: false, message: 'That file is over 8 MB.' }
  if (!ALLOWED.has(file.type)) return { ok: false, message: 'Use a photo or PDF.' }

  const bytes = Buffer.from(await file.arrayBuffer())
  const path = `scans/${randomUUID()}`
  const { error: uploadError } = await supabase.storage.from('vault').upload(path, bytes, { contentType: file.type })
  if (uploadError) return { ok: false, message: 'Could not save the file. Try again.' }

  const read = file.type.startsWith('image/') ? await readImage(bytes.toString('base64'), file.type) : null
  const { data: matched } = read?.merchant
    ? await supabase.from('suppliers').select('id').ilike('name', `%${read.merchant.replace(/[%_]/g, '')}%`).limit(1)
    : { data: null }

  const { error } = await supabase.from('documents').insert({
    kind: read?.kind === 'receipt' ? 'receipt' : read?.kind === 'invoice' ? 'invoice' : 'other',
    supplier_id: matched?.[0]?.id ?? null,
    merchant: read?.merchant ?? null,
    doc_date: read?.date ?? null,
    amount: read?.amount ?? null,
    storage_path: path,
    mime: file.type,
    created_by: user.id,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/scan')
  revalidatePath('/docs')
  const unsure = !read || read.confidence === 'low'
  return { ok: true, message: unsure ? 'Saved. An owner will check the details.' : `Read ${read.merchant ?? 'document'}, RM ${read.amount}. Waiting for an owner.` }
}

export async function submitClaim(amount: number, note: string, date: string): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: 'Please log in again.' }
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: 'Enter the amount.' }
  if (!note.trim()) return { ok: false, message: 'Say what the claim is for.' }
  const { error } = await supabase.from('documents').insert({
    kind: 'claim',
    amount,
    note: note.trim(),
    doc_date: asDate(date),
    created_by: user.id,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/scan')
  revalidatePath('/docs')
  return { ok: true, message: 'Claim sent to the owners.' }
}

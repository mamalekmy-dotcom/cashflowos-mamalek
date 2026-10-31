'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export async function createReviewLink(input: {
  label: string
  platform: string
  reviewUrl: string
  gift: string
}): Promise<{ ok: boolean; message: string }> {
  await requireOwner()
  if (!input.label.trim()) return { ok: false, message: 'Name this QR, for example Table 1.' }
  if (input.reviewUrl && !/^https:\/\//i.test(input.reviewUrl.trim())) {
    return { ok: false, message: 'The review link must start with https://' }
  }
  const { error } = await supabase.from('review_links').insert({
    token: randomBytes(9).toString('base64url'),
    label: input.label.trim(),
    platform: input.platform,
    review_url: input.reviewUrl.trim() || null,
    gift: input.gift.trim() || null,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/reviews')
  return { ok: true, message: 'QR created.' }
}

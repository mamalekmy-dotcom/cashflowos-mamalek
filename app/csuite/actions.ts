'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { ASSISTANT_NAME_KEY } from '@/lib/assistant-name'
import { supabase } from '@/lib/supabase'

export async function saveAssistantName(raw: string): Promise<{ ok: boolean; message: string }> {
  await requireOwner()
  const name = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
  if (!name) return { ok: false, message: 'Type a name.' }
  const { error } = await supabase.from('app_settings')
    .upsert({ key: ASSISTANT_NAME_KEY, value: { name }, updated_at: new Date().toISOString() })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/csuite')
  return { ok: true, message: `Renamed to ${name}. The 9am brief uses it from tomorrow.` }
}

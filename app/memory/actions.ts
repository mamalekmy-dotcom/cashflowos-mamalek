'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

export async function addMemory(kind: string, title: string, body: string): Promise<Result> {
  await requireOwner()
  if (!['dish', 'phrase', 'note'].includes(kind)) return { ok: false, message: 'Pick a type.' }
  if (!title.trim()) return { ok: false, message: 'Add a title.' }
  const { error } = await supabase.from('outlet_memory').insert({ kind, title: title.trim(), body: body.trim() || null })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/memory')
  return { ok: true, message: 'Saved.' }
}

export async function savePersona(name: string, language: string, manner: string): Promise<Result> {
  await requireOwner()
  if (!name.trim()) return { ok: false, message: 'Give your AI a name.' }
  const { error } = await supabase.from('app_settings').upsert({
    key: 'ai_persona',
    value: { name: name.trim(), language: language.trim() || 'English', manner: manner.trim() },
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/memory')
  revalidatePath('/chat')
  return { ok: true, message: 'Saved.' }
}

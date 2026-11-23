import 'server-only'
import { supabase, supabaseConfigured } from './supabase'

// The chief of staff's name: on the AI C Suite map and in the 9am brief. Owners change
// it on the AI C Suite page; it's kept in app_settings.
export const DEFAULT_ASSISTANT_NAME = 'Jarvis Oyen'
export const ASSISTANT_NAME_KEY = 'assistant_name'

export async function getAssistantName(): Promise<string> {
  if (!supabaseConfigured) return DEFAULT_ASSISTANT_NAME
  const { data } = await supabase.from('app_settings').select('value').eq('key', ASSISTANT_NAME_KEY).maybeSingle()
  const name = String((data?.value as any)?.name ?? '').trim()
  return name || DEFAULT_ASSISTANT_NAME
}

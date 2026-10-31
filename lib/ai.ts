import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'

// The app's AI: one short call, plus the persona and shop memory set in Outlet Memory.
// Returns null when the key is missing or the call fails, so callers can fall back.

const MODEL = 'claude-haiku-4-5'

export type Persona = { name: string; language: string; manner: string }
export const DEFAULT_PERSONA: Persona = { name: 'Mama Lek AI', language: 'English', manner: 'Short and direct' }

export async function getPersona(): Promise<Persona> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'ai_persona').maybeSingle()
  return { ...DEFAULT_PERSONA, ...((data?.value as Partial<Persona> | undefined) ?? {}) }
}

export async function memoryText(): Promise<string> {
  const { data } = await supabase.from('outlet_memory').select('kind, title, body').order('created_at').limit(60)
  return (data ?? []).map(m => `- [${m.kind}] ${m.title}${m.body ? `: ${m.body}` : ''}`).join('\n')
}

export async function askAI(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens = 400): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null
  try {
    const res = await new Anthropic({ apiKey }).messages.create({ model: MODEL, max_tokens: maxTokens, system, messages })
    return res.content.find(c => c.type === 'text')?.text?.trim() || null
  } catch (e) {
    console.error('[CFO] AI call failed:', e)
    return null
  }
}

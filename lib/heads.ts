import 'server-only'
import { supabase } from './supabase'
import type { ProposalDraft } from '@/agents/registry'

// The shared engine for the AI heads of Ops, Sales and Marketing (Finance has its own,
// lib/finance-head.ts, built first). Each head reads its numbers, checks them against
// the lines in agents/<head>/definition.ts, and the 9am cron turns its biggest alarm
// into ONE proposal a day. Approve = a task + a draft message. Nothing is ever sent.

export type Suggestion = { title: string; why: string; suggest: string; task: string; to: string; draft: string }
export type Reading = { kind: string; label: string; value: string; line: string; state: 'firing' | 'ok' | 'nodata' }
export type Alarm = { key: string; kind: string; impact: number; s: Suggestion }
export type Readout = { readings: Reading[]; alarms: Alarm[] }
export type HeadInfo = { key: string; emoji: string; name: string; taskDueDays: number }

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const pct = (n: number) => `${n.toFixed(1)}%`
export const weekdayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
export const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const PAGE = 1000
export async function readAll<T>(page: (first: number, last: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let first = 0; ; first += PAGE) {
    const { data, error } = await page(first, first + PAGE - 1)
    if (error) throw new Error(error.message)
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < PAGE) return rows
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ONE proposal: the biggest alarm not already brought to the owner. A card left to
// expire comes back the next morning under a new key (`…:again1`).
export async function headCheck(head: HeadInfo, readout: Readout, today: string): Promise<ProposalDraft[]> {
  const { alarms } = readout
  if (!alarms.length) return []
  const { data } = await supabase
    .from('agent_actions')
    .select('idempotency_key, status, expires_at')
    .eq('agent_key', head.key)
    .gte('proposed_at', `${addDays(today, -62)}T00:00:00Z`)
  const now = new Date().toISOString()
  const tries = (key: string) =>
    (data ?? []).filter(r => r.idempotency_key === key || new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:again\\d+$`).test(r.idempotency_key))
  const fresh = alarms
    .map(a => {
      const past = tries(a.key)
      const lapsed = (r: { status: string; expires_at: string }) => r.status === 'proposed' && r.expires_at <= now
      if (past.length && !past.every(lapsed)) return null
      return past.length ? { ...a, key: `${a.key}:again${past.length}` } : a
    })
    .filter((a): a is Alarm => a !== null)
  if (!fresh.length) return []

  const [top, ...rest] = fresh
  const also = rest.slice(0, 3).map(a => `• ${esc(a.s.title)}`).join('\n')
  const text =
    `${head.emoji} <b>Head of ${head.name}</b>\n<b>${esc(top.s.title)}</b>\n${esc(top.s.why)}\n\n` +
    `👉 ${esc(top.s.suggest)}\n\n` +
    `Approve = I add a task and give you a draft for ${esc(top.s.to)}. Nothing is sent.` +
    (also ? `\n\n<i>Also on my radar:</i>\n${also}` : '')
  return [{
    idempotencyKey: top.key,
    text,
    payload: {
      alarm: top.kind,
      head: head.name,
      note: `${top.s.title}. ${top.s.suggest}`,
      task: { title: top.s.task, due_date: addDays(today, head.taskDueDays) },
      to: top.s.to,
      channel: 'whatsapp',
      text: top.s.draft,
    },
  }]
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { answerStockCategory, answerStockQuestion, resumeDraft } from '@/lib/stock-pipeline'

// Answers a bill's question from the Approvals page, through the same functions as the
// Telegram buttons. Owners only. The bot then asks the next question or sends the
// Approve card, here and in Telegram.
export async function answerDraft(value: string): Promise<{ ok: boolean; message: string }> {
  await requireOwner()
  try {
    let message: string
    if (/^sm[si]:\d+:/.test(value)) {
      const res = await answerStockQuestion(value)
      message = res.notStock ? 'Marked as not a stock purchase.' : res.toast
    } else if (/^sxc:\d+:/.test(value)) {
      const [, id, ...name] = value.split(':')
      message = (await answerStockCategory(Number(id), name.join(':'))).toast
    } else if (/^ready:\d+$/.test(value)) {
      message = await resumeDraft(Number(value.slice(6)))
    } else {
      return { ok: false, message: 'Unknown answer.' }
    }
    revalidatePath('/approvals')
    return { ok: true, message }
  } catch (e: any) {
    return { ok: false, message: `The stock sheet was busy, nothing was saved. Try again. (${e?.message || e})` }
  }
}

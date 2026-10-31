'use server'

import ExcelJS from 'exceljs'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { parseColmo } from '@/lib/colmo'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

export async function logDay(saleDate: string, netSales: number): Promise<Result> {
  await requireOwner()
  if (!isDate(saleDate)) return { ok: false, message: 'Pick a day.' }
  if (!Number.isFinite(netSales) || netSales < 0) return { ok: false, message: 'Enter the sales amount.' }
  const { error } = await supabase
    .from('daily_sales')
    .upsert({ sale_date: saleDate, net_sales: netSales, source: 'manual', updated_at: new Date().toISOString() })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/pulse')
  return { ok: true, message: 'Saved.' }
}

export async function addCost(input: {
  date: string
  category: string
  amount: number
  note: string
}): Promise<Result> {
  const user = await requireOwner()
  if (!isDate(input.date)) return { ok: false, message: 'Pick a date.' }
  if (!['food', 'labor', 'rent', 'other'].includes(input.category)) return { ok: false, message: 'Pick a category.' }
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, message: 'Enter the amount.' }
  const { error } = await supabase.from('cost_entries').insert({
    entry_date: input.date,
    category: input.category,
    amount: input.amount,
    note: input.note.trim() || null,
    created_by: user.id,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/pulse')
  return { ok: true, message: 'Cost added.' }
}

// One or many months at once. Each day is replaced, so uploading a file twice is safe.
export async function uploadColmo(form: FormData): Promise<Result> {
  await requireOwner()
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { ok: false, message: 'Choose a Colmo Excel file.' }

  let days = 0
  try {
    for (const file of files) {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(await file.arrayBuffer())
      const sheet = book.worksheets[0]
      if (!sheet) throw new Error(`${file.name} is empty.`)
      const rows: unknown[][] = []
      sheet.eachRow(row => {
        const cells: unknown[] = []
        row.eachCell({ includeEmpty: true }, cell => cells.push(cell.text))
        rows.push(cells)
      })
      const parsed = parseColmo(rows).map(d => ({ ...d, source: 'colmo', updated_at: new Date().toISOString() }))
      const { error } = await supabase.from('daily_sales').upsert(parsed)
      if (error) throw new Error(error.message)
      days += parsed.length
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not read that file.' }
  }
  revalidatePath('/pulse')
  return { ok: true, message: `Loaded ${days} trading days from ${files.length} file${files.length > 1 ? 's' : ''}.` }
}

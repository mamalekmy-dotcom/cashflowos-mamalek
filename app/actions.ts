'use server'

import ExcelJS from 'exceljs'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth'
import { parseColmo } from '@/lib/colmo'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

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
  revalidatePath('/')
  return { ok: true, message: `Loaded ${days} trading days from ${files.length} file${files.length > 1 ? 's' : ''}.` }
}

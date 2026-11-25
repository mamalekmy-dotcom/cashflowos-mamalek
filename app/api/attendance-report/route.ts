import ExcelJS from 'exceljs'
import { getCurrentUser } from '@/lib/auth'
import { monthReport } from '@/lib/attendance-board'
import { FLAG_LABEL, dayOfIso, hoursText, timeText } from '@/lib/clock'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = { in: 'Clock in', out: 'Clock out', break_out: 'Start break', break_in: 'Back from break' }

// The month's attendance as an Excel file for payroll: a summary per person, and every
// punch with its flags and distance. Owners only.
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (user?.role !== 'owner') return new Response('Owners only', { status: 403 })
  const month = new URL(req.url).searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response('Pick a month', { status: 400 })
  const { rows, punches, names } = await monthReport(month)

  const wb = new ExcelJS.Workbook()
  const sum = wb.addWorksheet('Summary')
  sum.columns = [
    { header: 'Name', key: 'name', width: 24 }, { header: 'Days worked', key: 'days', width: 12 },
    { header: 'Hours', key: 'hours', width: 10 }, { header: 'Hours (h:mm)', key: 'hm', width: 12 },
    { header: 'Late', key: 'late', width: 8 }, { header: 'Late from break', key: 'lateBreak', width: 15 },
    { header: 'No GPS', key: 'noGps', width: 9 }, { header: 'No shift', key: 'offRoster', width: 9 },
    { header: 'Missing clock-out', key: 'missingOut', width: 16 }, { header: 'Absent', key: 'absent', width: 8 },
  ]
  for (const r of rows) sum.addRow({ ...r, hours: Math.round((r.minutes / 60) * 100) / 100, hm: hoursText(r.minutes) })
  sum.getRow(1).font = { bold: true }

  const all = wb.addWorksheet('Punches')
  all.columns = [
    { header: 'Date', key: 'date', width: 12 }, { header: 'Time', key: 'time', width: 8 }, { header: 'Name', key: 'name', width: 24 },
    { header: 'Punch', key: 'kind', width: 16 }, { header: 'Distance (m)', key: 'dist', width: 12 }, { header: 'Flags', key: 'flags', width: 30 },
  ]
  for (const p of punches) {
    all.addRow({
      date: dayOfIso(p.punched_at), time: timeText(p.punched_at), name: names.get(p.user_id) ?? `#${p.user_id}`,
      kind: KIND[p.kind] ?? p.kind, dist: p.distance_m ?? '', flags: (p.flags ?? []).map(f => FLAG_LABEL[f] ?? f).join(', '),
    })
  }
  all.getRow(1).font = { bold: true }

  const buf = await wb.xlsx.writeBuffer()
  return new Response(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Mama Lek attendance ${month}.xlsx"`,
    },
  })
}

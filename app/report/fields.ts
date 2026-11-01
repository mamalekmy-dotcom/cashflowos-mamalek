// The sales boxes on Daily Report, in the order they appear. Add a line here and a
// column on daily_reports to add a box. No server imports, so the form can use it.
export const SALES_FIELDS = [
  { key: 'cash', label: 'Cash sales (RM)' },
  { key: 'qr', label: 'QR sales (RM)' },
  { key: 'card', label: 'Card sales (RM)' },
  { key: 'sales_total', label: 'Sales total (RM)' },
  { key: 'cost_total', label: 'Cost total (RM)' },
  { key: 'profit_total', label: 'Profit total (RM)', canBeNegative: true },
  { key: 'total_discount', label: 'Total discount (RM)' },
  { key: 'total_void', label: 'Total void (RM)' },
  { key: 'total_tax', label: 'Total tax (RM)' },
  { key: 'unpaid_total', label: 'Unpaid total (RM)' },
  { key: 'total_pay_in', label: 'Total pay in (RM)' },
  { key: 'total_pay_out', label: 'Total pay out (RM)' },
  { key: 'receipt_count', label: 'No of receipt', isCount: true },
  { key: 'receipt_avg', label: 'Receipt average (RM)' },
  { key: 'total_pax', label: 'Total pax', isCount: true },
  { key: 'avg_per_pax', label: 'Average per pax (RM)' },
] as const

export type SalesKey = (typeof SALES_FIELDS)[number]['key']
export type SalesValues = Record<SalesKey, number>
export const SALES_COLUMNS = SALES_FIELDS.map(f => f.key).join(', ')

// The dashboard's daily tiles: everything except the three payment boxes.
export const DAILY_TILES = SALES_FIELDS.filter(f => !['cash', 'qr', 'card'].includes(f.key))

// "▲ 120 (5.2%)" against the day before. The percentage drops out when the day before
// was zero, since there's nothing to divide by.
export function changeText(now: number, before: number, show: (n: number) => string): string {
  const change = now - before
  if (change === 0) return 'Same as day before'
  const percent = before ? ` (${Math.abs((change / before) * 100).toFixed(1)}%)` : ''
  return `${change > 0 ? '▲' : '▼'} ${show(Math.abs(change))}${percent}`
}

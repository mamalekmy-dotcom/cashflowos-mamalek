import 'server-only'

// Reads sales from the GeniusPOS cloud. Read only: it never calls the import or online
// ordering endpoints, and never asks for Customer or AccountInfo (which holds staff
// POS passwords). Each run signs in afresh with the client ID and secret, so there is
// no refresh token to store.

const BASE = 'https://sd1003.geniuspos.com.my/api_access'
const HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'CashFlowOS/1.0' }
const OUTLET = process.env.GENIUSPOS_OUTLET?.trim() || 'outlet1'

type Row = Record<string, string | null>

export const posConfigured = () =>
  !!process.env.GENIUSPOS_CLIENT_ID?.trim() && !!process.env.GENIUSPOS_CLIENT_SECRET?.trim()

async function accessToken(): Promise<string> {
  const res = await fetch(`${BASE}/oauth_token`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      client_id: process.env.GENIUSPOS_CLIENT_ID?.trim(),
      client_secret: process.env.GENIUSPOS_CLIENT_SECRET?.trim(),
      grant_type: 'authorization_code',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`GeniusPOS sign-in failed (${res.status}${body.error ? `: ${body.error}` : ''})`)
  return body.access_token
}

async function resource(token: string, type: string, columns: string[], from?: string, to?: string): Promise<Row[]> {
  const res = await fetch(`${BASE}/resource/v2`, {
    method: 'POST',
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      resource_type: type, scope: 'read', outlet: OUTLET, show_column: columns,
      ...(from ? { start_date: `${from} 00:00:00`, end_date: `${to} 23:59:59` } : {}),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.status !== 'successful') throw new Error(`GeniusPOS ${type} failed (${res.status}${body.error ? `: ${body.error}` : ''})`)
  return (body.result?.user_data ?? []) as Row[]
}

const n = (v: string | null | undefined) => Number(v ?? 0) || 0
const round = (x: number) => Math.round(x * 100) / 100

export type PosDay = {
  date: string
  receipts: number
  pax: number
  grand_total: number
  tax: number
  service_charge: number
  sst: number
  rounding: number
  discount: number
  void_amount: number
  cost: number
  pay_in: number
  pay_out: number
  payments: Record<string, number>
}

// One summary per trading day between from and to (YYYY-MM-DD, inclusive).
export async function posDays(from: string, to: string): Promise<PosDay[]> {
  const token = await accessToken()
  const [bills, payments, taxes, orders, types, cash, taxInfo] = await Promise.all([
    resource(token, 'Transaction', ['idTransaction', 'ReceiptDateEnd', 'ReceiptGrandTotal', 'Rounding', 'DiscountOnReceiptAmt', 'DiscountOnItemAmt', 'NoOfPax', 'Voided'], from, to),
    resource(token, 'TransactionPayment', ['TransactionID', 'PaymentTypeID', 'PaymentAmountWorth'], from, to),
    resource(token, 'TransactionTax', ['TransactionID', 'TaxID', 'TaxAmount'], from, to),
    resource(token, 'TransactionOrder', ['TransactionID', 'Quantity', 'TransPrice', 'Cost', 'Voided'], from, to),
    resource(token, 'PaymentType', ['idPaymentType', 'PaymentName']),
    resource(token, 'PayInOut', ['Amount', 'Date'], from, to),
    resource(token, 'TaxInfo', ['idTaxInfo', 'TaxName', 'TaxAmt']),
  ])

  const typeName = new Map(types.map(t => [String(t.idPaymentType), String(t.PaymentName ?? 'Other')]))
  // Each tax line points at a TaxInfo row. The outlet charges a 10% service charge and
  // 6% SST; go by the name first, then by the rate.
  const isServiceCharge = new Map(taxInfo.map(t => {
    const name = String(t.TaxName ?? '').toUpperCase()
    const service = /SERVICE|\bSC\b|S\/C/.test(name) || (!/SST|GST|TAX/.test(name) && n(t.TaxAmt) === 10)
    return [String(t.idTaxInfo), service] as const
  }))
  const days = new Map<string, PosDay>()
  const dayOf = new Map<string, string>()
  const voidedBill = new Set<string>()
  const day = (date: string) => {
    if (!days.has(date)) days.set(date, { date, receipts: 0, pax: 0, grand_total: 0, tax: 0, service_charge: 0, sst: 0, rounding: 0, discount: 0, void_amount: 0, cost: 0, pay_in: 0, pay_out: 0, payments: {} })
    return days.get(date) as PosDay
  }

  for (const b of bills) {
    const date = String(b.ReceiptDateEnd ?? '').slice(0, 10)
    if (!date) continue
    const id = String(b.idTransaction)
    dayOf.set(id, date)
    const d = day(date)
    if (b.Voided !== '0') {
      voidedBill.add(id)
      d.void_amount += n(b.ReceiptGrandTotal)
      continue
    }
    d.receipts++
    d.pax += n(b.NoOfPax)
    d.grand_total += n(b.ReceiptGrandTotal)
    d.rounding += n(b.Rounding)
    d.discount += n(b.DiscountOnReceiptAmt) + n(b.DiscountOnItemAmt)
  }
  for (const p of payments) {
    const id = String(p.TransactionID)
    const date = dayOf.get(id)
    if (!date || voidedBill.has(id)) continue
    const name = typeName.get(String(p.PaymentTypeID)) ?? 'Other'
    const d = day(date)
    d.payments[name] = (d.payments[name] ?? 0) + n(p.PaymentAmountWorth)
  }
  for (const t of taxes) {
    const id = String(t.TransactionID)
    const date = dayOf.get(id)
    if (!date || voidedBill.has(id)) continue
    const d = day(date)
    d.tax += n(t.TaxAmount)
    if (isServiceCharge.get(String(t.TaxID))) d.service_charge += n(t.TaxAmount)
    else d.sst += n(t.TaxAmount)
  }
  for (const o of orders) {
    const id = String(o.TransactionID)
    const date = dayOf.get(id)
    if (!date || voidedBill.has(id)) continue
    if (o.Voided !== '0') day(date).void_amount += n(o.TransPrice) * n(o.Quantity)
    else day(date).cost += n(o.Cost) * n(o.Quantity)
  }
  for (const c of cash) {
    const date = String(c.Date ?? '').slice(0, 10)
    if (!date) continue
    const amount = n(c.Amount)
    if (amount >= 0) day(date).pay_in += amount
    else day(date).pay_out += -amount
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    ...d,
    grand_total: round(d.grand_total), tax: round(d.tax), service_charge: round(d.service_charge), sst: round(d.sst), rounding: round(d.rounding), discount: round(d.discount),
    void_amount: round(d.void_amount), cost: round(d.cost), pay_in: round(d.pay_in), pay_out: round(d.pay_out),
    payments: Object.fromEntries(Object.entries(d.payments).map(([k, v]) => [k, round(v)])),
  }))
}

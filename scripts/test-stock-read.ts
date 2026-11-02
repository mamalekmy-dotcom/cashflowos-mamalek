// Reads every bill photo in a folder and checks it adds up. Spends a little Anthropic credit.
//   node --env-file=.env scripts/test-stock-read.ts "C:\path\to\folder"
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error Node needs the .ts extension to run this file directly.
import { readBill, billProblems } from '../lib/stock-logic.ts'

const folder = process.argv[2]
const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!folder || !apiKey) throw new Error('Give a folder, and run with --env-file=.env')

for (const name of readdirSync(folder).filter(n => /\.jpe?g$/i.test(n)).sort()) {
  const base64 = readFileSync(join(folder, name)).toString('base64')
  const started = Date.now()
  const bill = await readBill(base64, 'image/jpeg', apiKey)
  console.log(`\n${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  if (!bill) { console.log('  unreadable'); continue }
  console.log(`  ${bill.type} | ${bill.supplier} | ${bill.invoice} | ${bill.date} | total ${bill.total}`)
  for (const l of bill.lines) console.log(`  - ${l.text} | ${l.qty} ${l.unit} @ ${l.price} = ${l.amount}`)
  const problems = billProblems(bill, '2026-11-01')
  if (problems.length) console.log(`  PROBLEMS: ${problems.join('; ')}`)
}

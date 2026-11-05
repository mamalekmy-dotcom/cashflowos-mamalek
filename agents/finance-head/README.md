# 💰 Head of Finance (AI C-Suite head #1)

The first head from `docs/ai-csuite-blueprint.md`. It reads the business every morning and
brings you **one** recommendation. It recommends, you decide.

| Knob | Mama Lek's answer | Lives in |
|---|---|---|
| **WHEN** | any line is crossed, checked daily at 9am with the morning brief | `definition.ts` |
| **LOOK AT** | `daily_sales`, `purchases`, `monthly_pnl`, `monthly_costs` | `lib/finance-head.ts` |
| **SUGGEST** | one fix a day, biggest RM first, plus a draft message | `prompt.ts` |
| **ASK BEFORE** | everything. Approve adds a task and hands you the draft | `agents/registry.ts` (`taskAndDraft`) |

## The lines

| Alarm | Fires when | Asks once per |
|---|---|---|
| Sales drop | yesterday is 15%+ below the last 4 same weekdays | day |
| Supplier spend jump | last 30 days is +20% **and** +RM500 over that supplier's usual | supplier, per month |
| Monthly cost alarm | labour over 22% or food cost over 28% (last TMS month) | month |
| Buying too much | last 30 days of purchases over 33% of sales | month |
| Wastage % *(next upgrade)* | over 3% of food cost; needs a wastage log first | — |

Change a number in `definition.ts` to move the line. Start strict and loosen as it proves right.

## 🔴 Never

It never sends a message, never moves money, never deletes. The draft is for you to send.

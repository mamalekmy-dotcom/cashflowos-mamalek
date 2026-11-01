# 📣 Head of Marketing — recommend-only

The first head of the AI C-Suite for the marketing lane (owner: Calixto95), built
from the blueprint canvas in `docs/ai-csuite-blueprint.md`.

> **WHEN** the morning cron runs, my Head of Marketing **looks at** the ad campaigns
> (`records`, `category = campaign`) and **suggests** a spend report, waste flags and
> festival post ideas — but it **asks a human before** anything is spent or published.

| | |
|---|---|
| **WHEN** | Daily, inside the existing `/api/cron-daily` sweep (no new cron). The spend report is Mondays only. |
| **LOOK AT** | Campaign rows: `amount` = budget, `due_date` = end date, `status` = planned / running / ended, `meta.channel`, `meta.spent`, `meta.leads` — the same fields as the Marketing tab. |
| **SUGGEST** | • Monday report: spend, leads and cost per lead by channel, costliest channel flagged<br>• Running campaign at ≥ 80% of budget<br>• Running campaign whose cost per lead is ≥ 1.5× the average<br>• Running campaign ending within 3 days<br>• Festival within 14 days with no campaign → a draft post idea |
| **ASK-BEFORE** | Always 🟡. Every item arrives as a proposal for a human. |
| **NEVER** 🔴 | Spend, boost, publish, message a customer, edit or delete rows. Its executor is `draftOnly`, which can't do any of those. |

The knobs: thresholds and the festival list are in `definition.ts`, the wording is in
`prompt.ts`, and the sweep is in `check.ts`. It's registered in `agents/registry.ts`
(AGENTS, EXECUTORS, SCHEDULED).

**Promoting it later:** once its recommendations prove right, the owner can add
`auto: true` to the report/flag drafts in `check.ts` to make them 🟢 (run and tell).
Spending or publishing can never be promoted — that code doesn't exist here.

**Festival dates** for Raya, CNY and Deepavali move each year — update `PROMOS` in
`definition.ts` once a year.

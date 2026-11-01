# HR release 1 · step 1: people, permissions and leave

## Turn it on (Eric, once)

1. Supabase → SQL Editor → paste all of `supabase/hr.sql` → Run. It only creates `hr_` tables and two functions; it changes nothing that exists and is safe to re-run.
2. Merge the PR. Vercel deploys it.
3. Open **People → HR → Settings** and give Su Ni the **HR admin** role (only an owner can).

## Then HR (Su Ni) fills in, from approved policy only

| Where | What | Status |
|---|---|---|
| HR → Settings → Leave types | Each type, whether half days are allowed, whether it can go below zero | **Needs management decision** |
| HR → People → (person) → Add entitlement | Days per person per year, with the source | **Needs management decision** |
| HR → Settings → Counting rules | Whether rest days or public holidays use leave. Default: every calendar day counts | **Needs management decision** |
| HR → Settings → Public holidays | The outlet's list for the year | From the 2026 holidays letter |
| HR → People | One profile per staff member, linked to their login, with "Reports to" | HR enters |
| HR → Settings → HR roles | Who is a supervisor (approves their team) or trainer | **Needs management decision** |

Who may cancel *approved* leave (today: the person's supervisor or HR, never the employee alone) is also a policy choice to confirm.

## Who sees what

| | Own record | Team | Everyone | Salary / IC / bank / medical | Settings |
|---|---|---|---|---|---|
| Employee | ✅ | | | | |
| Trainer | ✅ | | | ❌ | |
| Supervisor | ✅ | basics + leave | | ❌ | |
| HR admin / owner | ✅ | ✅ | ✅ | ✅ | ✅ |

Enforced on the server in `lib/hr/guard.ts` and in every action in `app/hr/actions.ts`. Someone outside your view gets a 404, so the page doesn't confirm they exist.

## Tests

- Rules (leave maths, half days, balances, permissions): `node --test scripts/hr-tests/`
- Database (approve once, overlap blocked, cancel writes a reversal, stale clicks refused, API locked out): `psql "<throwaway db>" -f supabase/hr-tests.sql`. It rolls back and leaves no rows. Needs `app_users` to exist.

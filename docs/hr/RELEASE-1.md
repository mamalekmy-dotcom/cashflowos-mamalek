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

---

# Step 2: company & culture, onboarding, training

## Turn it on (Eric, once)
Supabase → SQL Editor → paste all of `supabase/hr-2.sql` → Run (after `hr.sql`). New `hr_` tables only; safe to re-run.

## How it plugs into Google Drive
Nothing is copied out of Drive. Each **company topic** and each **course** stores a Drive link plus a version number.
- New or changed file in Drive → HR adds a **new version** with the link → **Publish**.
- Staff are asked to acknowledge the new version. Acknowledgements of earlier versions stay on record.
- A course's new version asks people who finished the old one to redo it.

## Pages
| Page | Who | What |
|---|---|---|
| `/hr/culture` | Everyone reads; HR manages | Published topics by section, acknowledge, acknowledgement counts, **flags for management review** (conflict / duplicate / unclear) |
| `/hr/onboarding` | HR, supervisors, trainers | Plans in progress; HR builds **templates** (Day 1, Day 2, Week 1…) |
| `/hr/onboarding/[id]` | The new staff member, their trainers, supervisor, HR | Each task records **instructed**, **practised**, **employee acknowledged** and **trainer assessed** separately, plus comments, follow-up and due dates. Trainers optional, blank by default |
| `/hr/onboarding/[id]/print` | Same | **A4 checklist** with tick boxes and signature lines |
| `/hr/learning` | HR, supervisors, trainers | Courses (SOP, PDF, video, text, practical), versions, assignments by everyone/department/position/person, due dates, refreshers; trainers **sign off practical** training |
| `/me` | Everyone | Next actions, onboarding, my training, company items to acknowledge, leave |

## Trainer access
A trainer reaches **training records only**: people in their trainer-grant department, or people whose onboarding plan names them. They never see profiles, leave, salary, IC, bank or medical details.

## Needs management input
- The onboarding PDF / handbook: HR links each section as a topic. Wording comes only from that file.
- Onboarding checklists per role: FOH, BOH, senior crew, supervisor.
- Which courses are required for whom, due dates, and refresher periods.
- Who are trainers.

## Tests
`node --test scripts/hr-tests/` (14) · `supabase/hr-tests.sql` (15) · `supabase/hr-2-tests.sql` (11). The SQL files roll back and leave nothing.

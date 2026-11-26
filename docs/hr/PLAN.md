# HR & People Development — plan (proposal, no code yet)

Owner: HR — Aw Su Ni (`suniawxv83-cell`). Status: **for review**. Nothing here is built until this PR is agreed.

Purpose: manage the staff journey (hiring → onboarding → training → assessment → performance → development → promotion → offboarding) for FOH, BOH, senior crew, supervisors and management, mobile-first.

---

## 1. What already exists (and what we reuse)

| Exists today | Where | Reuse for HR |
|---|---|---|
| Personal logins, sessions, disable-not-delete | `app_users`, `app_sessions`, `lib/session.ts`, `/admin` | **Every staff member's identity.** HR profiles link to `app_users.id`. Accounts are still created in `/admin` by an owner. |
| Page-level gate (deny by default) | `proxy.ts` 🔒, `lib/access.ts` | Gate `/me` (everyone) and `/hr/*` (HR roles). `proxy.ts` is **not** changed. |
| Server re-check in actions | `lib/auth.ts` (`getCurrentUser`, `requireOwner`) | Same pattern, plus new record-level checks (§3). |
| Roster, shift types, punches, OT approvals | `roster`, `shift_types`, `punches`, `ot_requests`, `/team`, `/clock` | Team availability for leave decisions; attendance on the employee page. The OT approve pattern (`update … where status='pending'`) is the model for leave approvals. |
| Private file storage | `vault` bucket, signed URLs | Restricted staff documents and training PDFs. |
| Telegram bot | `/api/telegram` | Later: "your leave was approved" DMs. Not in release 1. |
| Malaysian calendar day | `lib/attendance.ts` `dayOf()` (Asia/Kuala_Lumpur) | All HR business dates use the same helper. |

**Gaps today:** roles are page-level only (`owner/marketing/sales/ops/staff`). There is no reporting manager, no supervisor/trainer/HR distinction, and no record-level rule like "only see your own leave". That is the core new piece.

---

## 2. HR roles (separate from the app role)

App role still decides which *tabs* you can open. HR capability decides which *records* you can touch inside HR. Stored in `hr_grants`, set by HR admin/owner.

| HR capability | Can see | Can do |
|---|---|---|
| **Employee** (everyone with a profile) | Own profile, own leave + balances, own onboarding, assigned learning, published reviews, published company content | Apply/cancel own leave, acknowledge content + onboarding tasks, complete lessons |
| **Trainer** | Basic profile (name, department, position, photo) of people **assigned to them** + their onboarding/training records | Record instruction/practice, trainer assessment, comments. **Never** salary, medical, IC, disciplinary. |
| **Supervisor** | Basic profile of **their team** (manager chain) + team leave + onboarding + availability | Approve/reject team leave, assign onboarding/training |
| **HR admin** | All profiles incl. restricted fields | Manage profiles, leave rules, entitlements, templates, content versions, grants |
| **Owner** (app role) | Everything | Everything HR admin can |

Rules enforced on the server (not by hiding menus):
- Every HR query goes through `lib/hr/guard.ts` → `can(viewer, action, targetPersonId)`.
- Restricted data lives in a **separate table** (`hr_people_private`) that only HR-admin code paths read. Trainer/supervisor code never selects it, so there's no join to leak it.
- Supervisors cannot approve their own leave. A request needs someone else.
- Every write is recorded in `hr_audit`.

---

## 3. Proposed data model (release 1)

All new tables are prefixed `hr_`, RLS on with no policies (service role only, same as the rest of the app). Appended to `supabase/schema.sql` as one idempotent block for Eric to run.

**People & permissions**
- `hr_people` — `user_id → app_users` (nullable until they get a login), full_name, preferred_name, department (`FOH | BOH | Management`, editable list), position, career_level, `manager_id → hr_people`, join_date, employment_status (`probation | confirmed | notice | left`), probation_end, next_review_date, phone, emergency_contacts (jsonb), `is_demo` (bool).
- `hr_people_private` — person_id, IC/passport, bank, salary, medical notes. HR admin/owner only.
- `hr_documents` — person_id, kind, storage_path, expires_on, restricted (bool). Restricted = HR only.
- `hr_grants` — user_id, capability (`hr_admin | supervisor | trainer`), scope (`all` or a department).
- `hr_audit` — actor, action, table, row id, before/after (jsonb), at.

**Leave (rules are configurable — nothing invented)**
- `hr_leave_types` — code, name, allow_half_day, needs_approval, paid, accrual (jsonb: `none` / monthly pro-rata / etc.), carry_forward (jsonb), active. **Shipped empty**; management fills it in.
- `hr_leave_requests` — person_id, type, start_date, end_date, start_part/end_part (`full | am | pm`), days (computed server-side), reason, status (`pending | approved | rejected | cancelled`), decided_by, decided_at, `version` (for concurrent approvals).
- `hr_leave_ledger` — person_id, type, year, delta, kind (`entitlement | accrual | taken | reversal | adjustment`), request_id, note, by, at.
  **Balance = sum of ledger.** Pending = sum of pending requests. Available = balance − pending. Every number on screen can be explained line by line.
- Correctness rules: overlapping requests for the same person are refused; approval is a compare-and-swap on `status='pending' and version=n` so two approvers can't both win; cancelling an approved request writes a `reversal` row (never edits history); half days count 0.5; public holidays come from a configurable `hr_holidays` table (empty until management supplies the list).

**Company & culture**
- `hr_content` (slug, title, section) + `hr_content_versions` (version, body, source_ref = PDF page, status `draft | approved | published`, approved_by) + `hr_acknowledgements` (person_id, version_id, at) + `hr_content_flags` (conflict/duplicate notes for review).
- Content comes **only from the onboarding PDF** you supply. Anything conflicting or duplicated is flagged, not rewritten.

**Onboarding**
- `hr_onboarding_templates` (name, department, position) + `hr_onboarding_template_tasks` (checkpoint label e.g. Day 1 / Day 2 / Week 1 / Day 30, offset_days, title, instruction, order).
- `hr_onboarding_plans` — person_id, template_id, start_date, primary_trainer_id (**null by default**), backup_trainer_id (**null by default**), status.
- `hr_onboarding_tasks` — plan_id, title (snapshot), due_date, and **four separate records**: instructed (by/at), practised (at), employee acknowledged (at), trainer assessed (by/at/outcome `not_yet | competent | needs_follow_up`); plus comment, follow_up, follow_up_due.
- Printable A4 checklist: `/hr/onboarding/[id]/print` with print CSS.

**Learning (basic sign-off in release 1)**
- `hr_courses` (title, kind `sop | pdf | video | text | practical`) + `hr_course_versions` (body / storage_path / url) + `hr_assignments` (course, target `person | position | department`, due_in_days, refresher_months) + `hr_completions` (person, course_version, completed_at, signed_off_by).

**Demo data:** a separate `supabase/hr-demo.sql`, every row `is_demo = true` and named `DEMO — …`. Never run on the live database unless Eric chooses to. Real staff are entered by HR.

---

## 4. Pages (release 1)

| Path | Who | What |
|---|---|---|
| `/me` | Everyone | **Employee home:** my leave balances + requests, onboarding next steps, assigned learning, items to acknowledge |
| `/me/leave` | Everyone | Apply, cancel, track decisions, balance breakdown (ledger) |
| `/hr` | Supervisor / HR / owner | **Role home:** pending approvals, onboarding progress, overdue training; HR also sees headcount, probation deadlines, document expiry |
| `/hr/people`, `/hr/people/[id]` | HR (full), supervisor/trainer (limited columns) | Directory + profile |
| `/hr/leave` | Supervisor / HR | Requests to decide, team availability (with roster) |
| `/hr/settings` | HR admin / owner | Leave types, entitlements, holidays, grants |
| `/hr/culture` | Everyone reads; HR edits | Published content + acknowledgement |
| `/hr/onboarding` | Trainer / supervisor / HR | Templates, plans, task sign-offs, print |
| `/hr/learning` | Everyone (assigned) / HR | Courses, assignments, completion sign-off |

All server components, existing CSS classes, mobile-first.

---

## 5. Shared files this touches (needs owner OK)

| File | Owner | Change |
|---|---|---|
| `lib/access.ts` | shared | Add `/me` to `EVERYONE`; allow `/hr` for staff (record checks do the real gating inside) |
| `app/_components/Nav.tsx`, `BottomNav.tsx` | shared | Add "My HR" + "HR" under **People** |
| `supabase/schema.sql` | shared | Append the `hr_` block. **Eric runs it** (I don't hold keys) |
| `/team` (Talent HQ) | built by Eric | Untouched in release 1; later link roster availability into leave |

`proxy.ts`, `lib/session.ts` and the bot are **not** changed.

---

## 6. Release plan

1. **Release 1** (this plan): profiles + HR grants + server permission guard, employee home, leave (types, entitlements, ledger, apply/approve/cancel), company content with versions + acknowledgements, onboarding templates/plans/sign-offs + A4 print, basic training sign-off.
2. **Release 2:** quizzes; practical assessments with attempts, criteria, evidence, assessor sign-off; skills matrix (5 statuses, trainer approval separate); review templates (50% culture / 50% performance, KPIs with definition/target/period/weight/source/evidence, shared vs individual); self + manager review; development goals; promotion decision with manager approval (never automatic).
3. **Later:** hiring pipeline, benefits/recognition, restricted case management (concerns with alternative route when a supervisor is involved, disciplinary), offboarding.

Each release step is its own PR, built in small steps, with `npm run build` passing and the permission rules tested.

---

## 7. Needs management input (nothing invented)

- Leave types, yearly entitlements by level/years of service, accrual and carry-forward rules, half-day rules, notice periods.
- Public holiday list for the outlet.
- Who approves whom (manager chain) and who holds HR admin / supervisor / trainer.
- Probation length and review cycle.
- The onboarding PDF (source for company & culture content).
- The approved culture framework (for release 2 reviews).

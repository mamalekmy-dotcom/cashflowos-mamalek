-- Checks for supabase/hr.sql. Runs inside one transaction and ROLLS BACK at the end,
-- so it leaves no rows behind. Meant for a throwaway database; it uses only DEMO rows.
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/hr-tests.sql
begin;

create temp table t_log (name text, ok boolean);
create or replace function pg_temp.check(name text, ok boolean) returns void language sql
  as $$ insert into t_log values (name, coalesce(ok, false)) $$;

insert into app_users (name) values ('DEMO — approver'), ('DEMO — staff');
insert into hr_people (full_name, user_id, is_demo)
  select 'DEMO — Ali', id, true from app_users where name = 'DEMO — staff';
insert into hr_leave_types (code, name, allow_half_day) values ('demo_al', 'DEMO annual', true);

create temp table ids as
  select (select id from hr_people where full_name = 'DEMO — Ali') as person,
         (select id from app_users where name = 'DEMO — approver') as boss;

insert into hr_leave_ledger (person_id, leave_type, year, delta, kind, note)
  select person, 'demo_al', 2026, 8, 'entitlement', 'DEMO' from ids;

-- 1) Approve once: status flips, one 'taken' line.
insert into hr_leave_requests (person_id, leave_type, start_date, end_date, days)
  select person, 'demo_al', '2026-12-01', '2026-12-02', 2 from ids;
select pg_temp.check('approve ok',
  hr_decide_leave((select max(id) from hr_leave_requests), 1, true, (select boss from ids), null) = 'ok');
select pg_temp.check('second approver with old version is refused',
  hr_decide_leave((select max(id) from hr_leave_requests), 1, true, (select boss from ids), null) = 'not_pending');
select pg_temp.check('balance after approval = 6',
  (select sum(delta) from hr_leave_ledger, ids where person_id = person) = 6);

-- 2) Overlap with a live request is refused by the database.
do $$ begin
  insert into hr_leave_requests (person_id, leave_type, start_date, end_date, days)
    select person, 'demo_al', '2026-12-02', '2026-12-03', 2 from ids;
  perform pg_temp.check('overlap refused', false);
exception when exclusion_violation then
  perform pg_temp.check('overlap refused', true);
end $$;

-- 3) Cancel after approval writes a reversal and frees the dates.
select pg_temp.check('cancel approved ok',
  hr_cancel_leave((select max(id) from hr_leave_requests), 2, (select boss from ids), 'DEMO') = 'ok');
select pg_temp.check('balance back to 8',
  (select sum(delta) from hr_leave_ledger, ids where person_id = person) = 8);
select pg_temp.check('history kept: taken + reversal',
  (select count(*) from hr_leave_ledger where kind in ('taken', 'reversal')) = 2);
insert into hr_leave_requests (person_id, leave_type, start_date, end_date, days)
  select person, 'demo_al', '2026-12-02', '2026-12-02', 0.5 from ids;
select pg_temp.check('same dates usable after cancel', true);

-- 4) Stale version: a pending request edited elsewhere can't be decided on old data.
select pg_temp.check('stale version refused',
  hr_decide_leave((select max(id) from hr_leave_requests), 99, true, (select boss from ids), null) = 'stale');

-- 5) Reject never touches the ledger.
select pg_temp.check('reject ok',
  hr_decide_leave((select max(id) from hr_leave_requests), 1, false, (select boss from ids), 'DEMO') = 'ok');
select pg_temp.check('reject leaves balance at 8',
  (select sum(delta) from hr_leave_ledger, ids where person_id = person) = 8);
select pg_temp.check('cannot cancel a rejected request',
  hr_cancel_leave((select max(id) from hr_leave_requests), 2, (select boss from ids), null) = 'not_pending');

-- 6) A request can't span two leave years.
do $$ begin
  insert into hr_leave_requests (person_id, leave_type, start_date, end_date, days)
    select person, 'demo_al', '2026-12-31', '2027-01-01', 2 from ids;
  perform pg_temp.check('cross-year refused', false);
exception when check_violation then
  perform pg_temp.check('cross-year refused', true);
end $$;

-- 7) The public API roles can't call the decision functions.
select pg_temp.check('anon cannot decide',
  not has_function_privilege('anon', 'hr_decide_leave(bigint, integer, boolean, bigint, text)', 'execute'));
select pg_temp.check('authenticated cannot cancel',
  not has_function_privilege('authenticated', 'hr_cancel_leave(bigint, integer, bigint, text)', 'execute'));

select case when ok then 'PASS' else 'FAIL' end as result, name from t_log;
select count(*) filter (where not ok) as failures from t_log;
rollback;

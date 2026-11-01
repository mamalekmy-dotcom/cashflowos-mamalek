-- Checks for supabase/hr-2.sql. One transaction, ROLLED BACK at the end; DEMO rows only.
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/hr-2-tests.sql
begin;

create temp table t_log (name text, ok boolean);
create or replace function pg_temp.check(name text, ok boolean) returns void language sql
  as $$ insert into t_log values (name, coalesce(ok, false)) $$;

insert into hr_people (full_name, is_demo) values ('DEMO — Bee', true);
create temp table ids as select (select id from hr_people where full_name = 'DEMO — Bee') as person;

-- Content: only one published version per topic; acknowledgements are per version.
insert into hr_content (title, section) values ('DEMO — Values', 'Values');
insert into hr_content_versions (content_id, version, source_url, status)
  select id, 1, 'https://drive.google.com/demo-1', 'published' from hr_content where title = 'DEMO — Values';
do $$ begin
  insert into hr_content_versions (content_id, version, source_url, status)
    select id, 2, 'https://drive.google.com/demo-2', 'published' from hr_content where title = 'DEMO — Values';
  perform pg_temp.check('two published versions refused', false);
exception when unique_violation then perform pg_temp.check('two published versions refused', true);
end $$;
insert into hr_acknowledgements (person_id, version_id)
  select person, (select id from hr_content_versions where version = 1 and source_url like '%demo-1') from ids;
do $$ begin
  insert into hr_acknowledgements (person_id, version_id)
    select person, (select id from hr_content_versions where source_url like '%demo-1') from ids;
  perform pg_temp.check('double acknowledgement refused', false);
exception when unique_violation then perform pg_temp.check('double acknowledgement refused', true);
end $$;
-- Retire v1, publish v2: the old acknowledgement stays on record.
update hr_content_versions set status = 'retired' where source_url like '%demo-1';
insert into hr_content_versions (content_id, version, source_url, status)
  select id, 2, 'https://drive.google.com/demo-2', 'published' from hr_content where title = 'DEMO — Values';
select pg_temp.check('new version publishes after retiring old', (select count(*) from hr_content_versions where status = 'published' and source_url like '%demo-%') = 1);
select pg_temp.check('old acknowledgement kept', (select count(*) from hr_acknowledgements, ids where person_id = person) = 1);

-- Onboarding: trainers default to blank; four records are independent columns.
insert into hr_onboarding_plans (person_id, name, start_date) select person, 'DEMO plan', '2026-11-02' from ids;
select pg_temp.check('trainers blank by default',
  (select primary_trainer_id is null and backup_trainer_id is null from hr_onboarding_plans where name = 'DEMO plan'));
insert into hr_onboarding_tasks (plan_id, checkpoint, title, due_date)
  select id, 'Day 1', 'DEMO task', '2026-11-02' from hr_onboarding_plans where name = 'DEMO plan';
update hr_onboarding_tasks set practised_at = now() where title = 'DEMO task';
select pg_temp.check('recording practice does not fill the other records',
  (select instructed_at is null and acknowledged_at is null and assessed_at is null from hr_onboarding_tasks where title = 'DEMO task'));
do $$ begin
  update hr_onboarding_tasks set outcome = 'great' where title = 'DEMO task';
  perform pg_temp.check('unknown outcome refused', false);
exception when check_violation then perform pg_temp.check('unknown outcome refused', true);
end $$;

-- Training: a version needs a link or text; one completion per person, version and kind.
insert into hr_courses (title, kind) values ('DEMO — Wok station', 'practical');
do $$ begin
  insert into hr_course_versions (course_id, version) select id, 1 from hr_courses where title = 'DEMO — Wok station';
  perform pg_temp.check('empty course version refused', false);
exception when check_violation then perform pg_temp.check('empty course version refused', true);
end $$;
insert into hr_course_versions (course_id, version, body) select id, 1, 'DEMO' from hr_courses where title = 'DEMO — Wok station';
insert into hr_completions (person_id, course_version_id, kind)
  select person, (select id from hr_course_versions where body = 'DEMO'), 'trainer' from ids;
insert into hr_completions (person_id, course_version_id, kind)
  select person, (select id from hr_course_versions where body = 'DEMO'), 'self' from ids;
select pg_temp.check('self and trainer completions kept separately', (select count(*) from hr_completions, ids where person_id = person) = 2);
do $$ begin
  insert into hr_completions (person_id, course_version_id, kind)
    select person, (select id from hr_course_versions where body = 'DEMO'), 'trainer' from ids;
  perform pg_temp.check('double sign-off refused', false);
exception when unique_violation then perform pg_temp.check('double sign-off refused', true);
end $$;
do $$ begin
  insert into hr_assignments (course_id, target_kind, due_days) select id, 'team', 7 from hr_courses where title = 'DEMO — Wok station';
  perform pg_temp.check('unknown assignment target refused', false);
exception when check_violation then perform pg_temp.check('unknown assignment target refused', true);
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, name from t_log;
select count(*) filter (where not ok) as failures from t_log;
rollback;

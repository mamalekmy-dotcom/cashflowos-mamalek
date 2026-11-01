-- ============================================================
-- HR & PEOPLE — release 1, step 2: company & culture, onboarding, training.
-- Owner: HR (Aw Su Ni). Run AFTER hr.sql. Safe to re-run; never deletes rows.
--
-- Content lives in Google Drive. These tables hold the LINK and a version number,
-- never a copy of the wording, so the Drive file stays the one source of truth.
-- ============================================================

-- ------------------------------------------------------------
-- Company & culture: one item per topic, one row per published version, and a
-- record of who acknowledged which version.
-- ------------------------------------------------------------
create table if not exists hr_content (
  id         bigint generated always as identity primary key,
  title      text        not null,
  section    text        not null,          -- e.g. Background, Mission, Values, Conduct, Policy
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists hr_content_versions (
  id            bigint generated always as identity primary key,
  content_id    bigint      not null references hr_content(id) on delete cascade,
  version       integer     not null,
  source_url    text        not null,        -- the Drive file
  source_ref    text,                        -- page or heading inside it
  change_note   text,                        -- what changed since the last version
  status        text        not null default 'draft' check (status in ('draft', 'published', 'retired')),
  requires_ack  boolean     not null default true,
  published_by  bigint      references app_users(id) on delete set null,
  published_at  timestamptz,
  created_by    bigint      references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (content_id, version)
);
-- At most one published version per item at a time.
create unique index if not exists hr_content_one_published on hr_content_versions (content_id) where status = 'published';

create table if not exists hr_acknowledgements (
  id              bigint generated always as identity primary key,
  person_id       bigint      not null references hr_people(id) on delete cascade,
  version_id      bigint      not null references hr_content_versions(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (person_id, version_id)
);

-- Conflicting, duplicate or unclear material, parked for management review.
create table if not exists hr_content_flags (
  id          bigint generated always as identity primary key,
  content_id  bigint      references hr_content(id) on delete set null,
  kind        text        not null check (kind in ('conflict', 'duplicate', 'unclear')),
  note        text        not null,
  status      text        not null default 'open' check (status in ('open', 'resolved')),
  created_by  bigint      references app_users(id) on delete set null,
  resolved_by bigint      references app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Onboarding. Templates are reusable; a plan copies the template's tasks for one
-- person, so editing a template later never rewrites someone's history.
-- Trainers are optional and blank by default.
-- ------------------------------------------------------------
create table if not exists hr_onboarding_templates (
  id         bigint generated always as identity primary key,
  name       text        not null,
  department text,
  position   text,
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

create table if not exists hr_onboarding_template_tasks (
  id          bigint generated always as identity primary key,
  template_id bigint      not null references hr_onboarding_templates(id) on delete cascade,
  checkpoint  text        not null,           -- Day 1, Day 2, Week 1, Day 30 …
  day_offset  integer     not null default 0, -- days after the start date it's due
  title       text        not null,
  instruction text,
  source_url  text,                           -- Drive file with the details, if any
  position    integer     not null default 0
);

create table if not exists hr_onboarding_plans (
  id                bigint generated always as identity primary key,
  person_id         bigint      not null references hr_people(id) on delete cascade,
  template_id       bigint      references hr_onboarding_templates(id) on delete set null,
  name              text        not null,
  start_date        date        not null,
  primary_trainer_id bigint     references app_users(id) on delete set null,
  backup_trainer_id  bigint     references app_users(id) on delete set null,
  status            text        not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_by        bigint      references app_users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists hr_onboarding_plans_person_idx on hr_onboarding_plans (person_id);

-- Four separate records per task: instructed, practised, acknowledged by the
-- employee, and assessed by the trainer. Each keeps who and when.
create table if not exists hr_onboarding_tasks (
  id              bigint generated always as identity primary key,
  plan_id         bigint      not null references hr_onboarding_plans(id) on delete cascade,
  checkpoint      text        not null,
  title           text        not null,
  instruction     text,
  source_url      text,
  due_date        date,
  position        integer     not null default 0,
  instructed_by   bigint      references app_users(id) on delete set null,
  instructed_at   timestamptz,
  practised_by    bigint      references app_users(id) on delete set null,
  practised_at    timestamptz,
  acknowledged_at timestamptz,
  assessed_by     bigint      references app_users(id) on delete set null,
  assessed_at     timestamptz,
  outcome         text        check (outcome in ('not_yet', 'competent', 'needs_follow_up')),
  comment         text,
  follow_up       text,
  follow_up_due   date
);
create index if not exists hr_onboarding_tasks_plan_idx on hr_onboarding_tasks (plan_id);

-- ------------------------------------------------------------
-- Training. A course has versions (each a Drive link or short text); assignments
-- say who must do it; completions record who did which version, and who signed off.
-- ------------------------------------------------------------
create table if not exists hr_courses (
  id          bigint generated always as identity primary key,
  title       text        not null,
  kind        text        not null check (kind in ('sop', 'pdf', 'video', 'text', 'practical')),
  description text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists hr_course_versions (
  id           bigint generated always as identity primary key,
  course_id    bigint      not null references hr_courses(id) on delete cascade,
  version      integer     not null,
  source_url   text,
  body         text,
  change_note  text,
  created_by   bigint      references app_users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (course_id, version),
  check (source_url is not null or body is not null)
);

create table if not exists hr_assignments (
  id               bigint generated always as identity primary key,
  course_id        bigint      not null references hr_courses(id) on delete cascade,
  target_kind      text        not null check (target_kind in ('everyone', 'department', 'position', 'person')),
  target           text,                     -- department name, position name or hr_people id
  due_days         integer     not null default 14 check (due_days >= 0),
  refresher_months integer     check (refresher_months > 0),
  active           boolean     not null default true,
  created_by       bigint      references app_users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists hr_completions (
  id                bigint generated always as identity primary key,
  person_id         bigint      not null references hr_people(id) on delete cascade,
  course_version_id bigint      not null references hr_course_versions(id) on delete cascade,
  kind              text        not null check (kind in ('self', 'trainer')),
  signed_off_by     bigint      references app_users(id) on delete set null,
  note              text,
  completed_at      timestamptz not null default now(),
  unique (person_id, course_version_id, kind)
);

alter table hr_content                   enable row level security;
alter table hr_content_versions          enable row level security;
alter table hr_acknowledgements          enable row level security;
alter table hr_content_flags             enable row level security;
alter table hr_onboarding_templates      enable row level security;
alter table hr_onboarding_template_tasks enable row level security;
alter table hr_onboarding_plans          enable row level security;
alter table hr_onboarding_tasks          enable row level security;
alter table hr_courses                   enable row level security;
alter table hr_course_versions           enable row level security;
alter table hr_assignments               enable row level security;
alter table hr_completions               enable row level security;

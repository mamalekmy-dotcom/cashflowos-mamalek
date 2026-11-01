-- ============================================================
-- HR & PEOPLE — release 1 foundation (profiles, HR grants, leave, audit).
-- Owner: HR (Aw Su Ni). Run AFTER schema.sql, in the Supabase SQL Editor. Safe to
-- re-run: create-if-not-exists everywhere, and it never deletes rows.
--
-- Nothing in here sets a policy. Leave types, entitlements and holidays start EMPTY
-- and are filled in by HR from /hr/settings once management has decided them.
-- ============================================================

create extension if not exists btree_gist;   -- lets Postgres refuse overlapping leave

-- ------------------------------------------------------------
-- hr_people — one row per staff member. user_id links to their login (null until
-- the admin creates one). Restricted fields live in hr_people_private, never here.
-- ------------------------------------------------------------
create table if not exists hr_people (
  id                 bigint generated always as identity primary key,
  user_id            bigint      unique references app_users(id) on delete set null,
  full_name          text        not null,
  preferred_name     text,
  department         text,                                  -- FOH | BOH | Management (editable list)
  position           text,
  career_level       text,
  manager_id         bigint      references hr_people(id) on delete set null,
  join_date          date,
  employment_status  text        not null default 'probation'
                     check (employment_status in ('probation', 'confirmed', 'notice', 'left')),
  probation_end      date,
  next_review_date   date,
  phone              text,
  emergency_contacts jsonb       not null default '[]'::jsonb,   -- [{name, relation, phone}]
  is_demo            boolean     not null default false,         -- demo rows are named "DEMO — …"
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (manager_id is null or manager_id <> id)
);
create index if not exists hr_people_manager_idx on hr_people (manager_id);

-- Only HR admins and owners ever read this table. Trainer and supervisor code never
-- selects it, so there is no join that could leak salary or medical details.
create table if not exists hr_people_private (
  person_id     bigint      primary key references hr_people(id) on delete cascade,
  id_number     text,
  bank_details  text,
  salary        numeric,
  medical_notes text,
  updated_at    timestamptz not null default now()
);

-- HR capabilities, separate from the app role. department '*' means every department.
create table if not exists hr_grants (
  id         bigint generated always as identity primary key,
  user_id    bigint      not null references app_users(id) on delete cascade,
  capability text        not null check (capability in ('hr_admin', 'supervisor', 'trainer')),
  department text        not null default '*',
  created_by bigint      references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, capability, department)
);

-- Every HR write leaves a line here.
create table if not exists hr_audit (
  id        bigint generated always as identity primary key,
  actor_id  bigint      references app_users(id) on delete set null,
  action    text        not null,
  entity    text        not null,
  entity_id bigint,
  detail    jsonb       not null default '{}'::jsonb,
  at        timestamptz not null default now()
);
create index if not exists hr_audit_entity_idx on hr_audit (entity, entity_id);

-- ------------------------------------------------------------
-- Leave. Balance = sum of hr_leave_ledger. Requests never change the ledger until
-- they are approved, and a cancelled approval writes a reversal, never an edit.
-- ------------------------------------------------------------
create table if not exists hr_leave_types (
  code           text        primary key,
  name           text        not null,
  allow_half_day boolean     not null default false,
  allow_negative boolean     not null default false,   -- e.g. unpaid leave with no entitlement
  active         boolean     not null default true,
  notes          text,
  updated_at     timestamptz not null default now()
);

create table if not exists hr_holidays (
  day  date primary key,
  name text not null
);

create table if not exists hr_leave_requests (
  id            bigint generated always as identity primary key,
  person_id     bigint      not null references hr_people(id) on delete cascade,
  leave_type    text        not null references hr_leave_types(code) on update cascade,
  start_date    date        not null,
  end_date      date        not null,
  start_part    text        not null default 'full' check (start_part in ('full', 'am', 'pm')),
  end_part      text        not null default 'full' check (end_part in ('full', 'am', 'pm')),
  days          numeric     not null check (days > 0),
  reason        text,
  status        text        not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  version       integer     not null default 1,
  decided_by    bigint      references app_users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_by    bigint      references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (extract(year from start_date) = extract(year from end_date)),
  -- One person can't hold two live requests on the same day, even if two tabs race.
  constraint hr_leave_no_overlap exclude using gist (
    person_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'approved'))
);
create index if not exists hr_leave_requests_status_idx on hr_leave_requests (status);

create table if not exists hr_leave_ledger (
  id         bigint generated always as identity primary key,
  person_id  bigint      not null references hr_people(id) on delete cascade,
  leave_type text        not null references hr_leave_types(code) on update cascade,
  year       integer     not null,
  delta      numeric     not null,
  kind       text        not null check (kind in ('entitlement', 'accrual', 'taken', 'reversal', 'adjustment')),
  request_id bigint      references hr_leave_requests(id) on delete restrict,
  note       text,
  created_by bigint      references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_leave_ledger_person_idx on hr_leave_ledger (person_id, leave_type, year);
-- A request can be taken once and reversed once, never twice.
create unique index if not exists hr_leave_ledger_once on hr_leave_ledger (request_id, kind)
  where request_id is not null;

-- ------------------------------------------------------------
-- Decisions run inside Postgres so the status change and the ledger line happen
-- together or not at all. Each checks the version it was shown, so two approvers
-- clicking at once can't both win.
-- Returns 'ok', or a short reason: 'stale', 'not_pending', 'not_approved'.
-- ------------------------------------------------------------
create or replace function hr_decide_leave(
  p_request bigint, p_version integer, p_approve boolean, p_actor bigint, p_note text
) returns text language plpgsql as $$
declare r hr_leave_requests;
begin
  update hr_leave_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         version = version + 1, decided_by = p_actor, decided_at = now(), decision_note = p_note
   where id = p_request and status = 'pending' and version = p_version
  returning * into r;
  if not found then
    return case when exists (select 1 from hr_leave_requests where id = p_request and status = 'pending')
                then 'stale' else 'not_pending' end;
  end if;
  if p_approve then
    insert into hr_leave_ledger (person_id, leave_type, year, delta, kind, request_id, created_by, note)
    values (r.person_id, r.leave_type, extract(year from r.start_date)::int, -r.days, 'taken', r.id, p_actor, 'Approved leave');
  end if;
  insert into hr_audit (actor_id, action, entity, entity_id, detail)
  values (p_actor, case when p_approve then 'approve' else 'reject' end, 'hr_leave_requests', r.id,
          jsonb_build_object('days', r.days, 'note', p_note));
  return 'ok';
end $$;

-- Cancel: a pending request just closes. An approved one gets its days back through
-- a reversal line, so the history still shows it was taken and returned.
create or replace function hr_cancel_leave(
  p_request bigint, p_version integer, p_actor bigint, p_note text
) returns text language plpgsql as $$
declare r hr_leave_requests; was text;
begin
  select status into was from hr_leave_requests where id = p_request;
  update hr_leave_requests
     set status = 'cancelled', version = version + 1, decided_by = p_actor, decided_at = now(),
         decision_note = coalesce(p_note, decision_note)
   where id = p_request and status in ('pending', 'approved') and version = p_version
  returning * into r;
  if not found then
    return case when was in ('pending', 'approved') then 'stale' else 'not_pending' end;
  end if;
  if was = 'approved' then
    insert into hr_leave_ledger (person_id, leave_type, year, delta, kind, request_id, created_by, note)
    values (r.person_id, r.leave_type, extract(year from r.start_date)::int, r.days, 'reversal', r.id, p_actor, 'Cancelled after approval');
  end if;
  insert into hr_audit (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'cancel', 'hr_leave_requests', r.id, jsonb_build_object('was', was, 'days', r.days, 'note', p_note));
  return 'ok';
end $$;

-- Only the server (service role) may call these. By default Postgres lets anyone
-- execute a new function, and Supabase exposes functions over its public API.
revoke all on function hr_decide_leave(bigint, integer, boolean, bigint, text) from public, anon, authenticated;
revoke all on function hr_cancel_leave(bigint, integer, bigint, text) from public, anon, authenticated;

alter table hr_people         enable row level security;
alter table hr_people_private enable row level security;
alter table hr_grants         enable row level security;
alter table hr_audit          enable row level security;
alter table hr_leave_types    enable row level security;
alter table hr_holidays       enable row level security;
alter table hr_leave_requests enable row level security;
alter table hr_leave_ledger   enable row level security;

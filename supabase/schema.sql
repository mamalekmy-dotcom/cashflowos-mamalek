-- ============================================================
-- CASHFLOWOS AI AGENTS — your Money Robot's database.
-- Paste this WHOLE block into the Supabase SQL Editor (your own free project)
-- and click Run once. Safe to re-run: it never duplicates or deletes your rows
-- (create-if-not-exists · add-column-if-not-exists · seeds guarded by NOT EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1) records — the business spine. One row = one thing you track.
--    Categories: cash_in | cash_out | lead | customer | content | task | doc
-- ------------------------------------------------------------
create table if not exists records (
  id          bigint generated always as identity primary key,
  title       text        not null,
  status      text        not null default 'open',   -- free text; leads use the funnel stages
  amount      numeric     default 0,                 -- RM value if money-related, else 0
  category    text,                                  -- cash_in | cash_out | lead | customer | content | task | doc
  due_date    date,
  notes       text,
  meta        jsonb       not null default '{}'::jsonb, -- extra per-tab fields (platform, format, views, next...)
  created_at  timestamptz not null default now()
);
alter table records add column if not exists meta jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------
-- 2) agent_actions — the proposals/approvals table. THE HITL HEART.
--    A robot's wish is written here ONCE, a human (or the autopilot dial) decides,
--    then it's claimed + executed exactly once. Never fold this into records.
-- ------------------------------------------------------------
create table if not exists agent_actions (
  id                bigint generated always as identity primary key,
  agent_key         text        not null,
  idempotency_key   text        not null unique,      -- dedupe: one wish per event
  payload           jsonb       not null,             -- written once, immutable
  status            text        not null default 'proposed',
                    -- proposed | approved | rejected | expired | executing | executed | failed
  proposed_at       timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  decided_at        timestamptz,
  executed_at       timestamptz,
  approver_chat_id  bigint,                            -- null = decided by the robot (autopilot)
  result            jsonb,
  error             text,
  notify_chat_id    bigint,                            -- captured from sendWithButtons()...
  notify_message_id bigint                             -- ...so the in-app approve path can strip the buttons
);
-- add-column-if-not-exists guards, in case an older version of this file ran first
alter table agent_actions add column if not exists notify_chat_id    bigint;
alter table agent_actions add column if not exists notify_message_id bigint;
alter table agent_actions add column if not exists result            jsonb;
alter table agent_actions add column if not exists error             text;

-- ------------------------------------------------------------
-- 3) agent_runs — one row per agent invocation. Feeds the Activity view.
-- ------------------------------------------------------------
create table if not exists agent_runs (
  id          bigint generated always as identity primary key,
  agent_key   text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text,                                    -- ok | escalated | failed | noop ...
  detail      jsonb       not null default '{}'::jsonb
);

-- ------------------------------------------------------------
-- 4) vault_files — uploaded receipts/docs. The dedupe constraint lives HERE
--    (sha256 unique), not in a jsonb expression index.
-- ------------------------------------------------------------
create table if not exists vault_files (
  id                   bigint generated always as identity primary key,
  sha256               text        not null unique,     -- same file twice = same hash = skip
  storage_path         text,
  mime                 text,
  size_bytes           bigint,
  uploaded_by_chat_id  bigint,
  record_id            bigint,                           -- links to the records row it created
  created_at           timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5) bot_memory — the bot's short-term memory + per-chat daily counters
--    (e.g. the vision-call cost cap). Read/written by lib/bot-memory.ts.
-- ------------------------------------------------------------
create table if not exists bot_memory (
  chat_id     bigint      primary key,
  turns       jsonb       not null default '[]'::jsonb,
  counters    jsonb       not null default '{}'::jsonb,  -- {"vision:2026-07-23": 3}
  updated_at  timestamptz not null default now()
);
alter table bot_memory add column if not exists counters jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------
-- 6) tg_updates — Telegram delivery dedupe. Telegram RETRIES un-acked webhooks;
--    inserting the update_id here 'on conflict do nothing' means a retry of an
--    in-flight update is a 0-row no-op → we never double-process a photo.
-- ------------------------------------------------------------
create table if not exists tg_updates (
  update_id   bigint      primary key,
  received_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7) app_users — who can log in, and what they can reach. Passwords live in
--    Supabase Auth (auth_id links to it), never here. extra_tabs adds tabs on top
--    of the role. A disabled person keeps their row, so history keeps their name.
-- ------------------------------------------------------------
create table if not exists app_users (
  id                   bigint generated always as identity primary key,
  auth_id              uuid        unique,
  email                text        not null unique,
  name                 text        not null,
  role                 text        not null default 'staff',   -- owner | marketing | sales | ops | staff
  extra_tabs           text[]      not null default '{}',
  telegram_id          bigint      unique,
  active               boolean     not null default true,
  must_change_password boolean     not null default true,
  created_at           timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8) app_sessions — one row per logged-in device. Only a hash of the cookie is
--    stored. Deleting the rows logs that person out at once.
-- ------------------------------------------------------------
create table if not exists app_sessions (
  token_hash text        primary key,
  user_id    bigint      not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_sessions_user_id_idx on app_sessions (user_id);

-- ------------------------------------------------------------
-- 9) daily_sales — one row per trading day, so re-uploading a report replaces the
--    day instead of doubling it. Kept out of records: it would grow past the API's
--    row limit and every page loads all of records.
-- ------------------------------------------------------------
create table if not exists daily_sales (
  sale_date  date        primary key,
  net_sales  numeric     not null default 0,
  dine_in    numeric     not null default 0,
  to_go      numeric     not null default 0,
  delivery   numeric     not null default 0,
  discount   numeric     not null default 0,
  voids      numeric     not null default 0,
  receipts   integer     not null default 0,
  pax        integer     not null default 0,
  cash       numeric     not null default 0,
  qr         numeric     not null default 0,
  card       numeric     not null default 0,
  online     numeric     not null default 0,
  source     text        not null default 'manual',    -- manual | colmo
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 10) cost_entries — what P&L Pulse splits sales into.
-- ------------------------------------------------------------
create table if not exists cost_entries (
  id         bigint generated always as identity primary key,
  entry_date date        not null,
  category   text        not null check (category in ('food', 'labor', 'rent', 'other')),
  amount     numeric     not null check (amount >= 0),
  note       text,
  created_by bigint      references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cost_entries_date_idx on cost_entries (entry_date);

-- ------------------------------------------------------------
-- 11) suppliers + supplier_products — who you buy from, and what.
-- ------------------------------------------------------------
create table if not exists suppliers (
  id         bigint generated always as identity primary key,
  name       text        not null unique,
  phone      text,
  address    text,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists supplier_products (
  id          bigint generated always as identity primary key,
  supplier_id bigint      not null references suppliers(id) on delete cascade,
  name        text        not null,
  unit        text,
  price       numeric,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 12) documents — everything scanned: invoices, receipts and staff claims. A scan
--     starts 'new' and only becomes a cost once an owner accepts it, so a misread
--     photo can't reach the P&L on its own.
-- ------------------------------------------------------------
create table if not exists documents (
  id           bigint generated always as identity primary key,
  kind         text        not null default 'invoice',    -- invoice | receipt | claim | other
  status       text        not null default 'new',        -- new | accepted | rejected
  supplier_id  bigint      references suppliers(id) on delete set null,
  merchant     text,
  doc_date     date,
  amount       numeric,
  note         text,
  storage_path text,
  mime         text,
  created_by   bigint      references app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists documents_created_by_idx on documents (created_by);

-- ------------------------------------------------------------
-- 13) app_settings — small shop-wide values, such as the Doc Center PIN hash.
-- ------------------------------------------------------------
create table if not exists app_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 14) shift_types + roster — the hours the shop runs, and who works which.
-- ------------------------------------------------------------
create table if not exists shift_types (
  code       text primary key,
  start_time time not null,
  end_time   time not null
);

create table if not exists roster (
  user_id    bigint not null references app_users(id) on delete cascade,
  work_date  date   not null,
  shift_code text   not null references shift_types(code) on update cascade,
  primary key (user_id, work_date)
);

-- ------------------------------------------------------------
-- 15) punches — clock in and out. Distance from the shop is stored at punch time,
--     so moving the shop pin later can't rewrite history.
-- ------------------------------------------------------------
create table if not exists punches (
  id          bigint generated always as identity primary key,
  user_id     bigint      not null references app_users(id) on delete cascade,
  kind        text        not null check (kind in ('in', 'out')),
  punched_at  timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  distance_m  integer,
  photo_path  text
);
create index if not exists punches_user_time_idx on punches (user_id, punched_at);

-- ------------------------------------------------------------
-- 16) ot_requests — one per clock-out past the shift's end. Hours only, not pay.
-- ------------------------------------------------------------
create table if not exists ot_requests (
  id         bigint generated always as identity primary key,
  user_id    bigint      not null references app_users(id) on delete cascade,
  work_date  date        not null,
  hours      numeric     not null,
  status     text        not null default 'pending',   -- pending | approved | denied
  decided_by bigint      references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, work_date)
);

-- ------------------------------------------------------------
-- 17) chat_messages — the team rooms. Private rooms belong to one person.
-- ------------------------------------------------------------
create table if not exists chat_messages (
  id         bigint generated always as identity primary key,
  room       text        not null,                 -- ai | foh | kitchen | private
  user_id    bigint      references app_users(id) on delete cascade,  -- owner of the thread for ai/private; sender elsewhere
  is_ai      boolean     not null default false,
  body       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on chat_messages (room, created_at);

-- ------------------------------------------------------------
-- 18) outlet_memory — what the AI should know about this shop.
-- ------------------------------------------------------------
create table if not exists outlet_memory (
  id         bigint generated always as identity primary key,
  kind       text        not null default 'note',   -- dish | phrase | note
  title      text        not null,
  body       text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 19) review_links + review_events — table QR codes for guest reviews.
-- ------------------------------------------------------------
create table if not exists review_links (
  id         bigint generated always as identity primary key,
  token      text        not null unique,
  label      text        not null,
  platform   text        not null default 'google',
  review_url text,
  gift       text,
  created_at timestamptz not null default now()
);

create table if not exists review_events (
  id         bigint generated always as identity primary key,
  link_id    bigint      not null references review_links(id) on delete cascade,
  rating     integer,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- monthly_pnl — one row per month, copied from the TMS report. When a month has a
-- row here, P&L Pulse uses it instead of adding up daily_sales and cost_entries.
-- ------------------------------------------------------------
create table if not exists monthly_pnl (
  month             text        primary key,
  gross_sales       numeric     not null default 0,
  net_sales         numeric     not null default 0,
  cogs              numeric     not null default 0,
  variable_costs    numeric     not null default 0,
  purchases         numeric     not null default 0,
  opening_stock     numeric     not null default 0,
  closing_stock     numeric     not null default 0,
  labor             numeric     not null default 0,
  rent              numeric     not null default 0,
  fixed_costs       numeric     not null default 0,
  profit_before_tax numeric     not null default 0,
  tax_estimate      numeric     not null default 0,
  pax               integer     not null default 0,
  source            text        not null default 'tms',
  updated_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- purchases + stock_counts — loaded from the Stock workbook by scripts/import-stock.mjs.
-- ------------------------------------------------------------
create table if not exists purchases (
  id            bigint generated always as identity primary key,
  purchase_date date    not null,
  supplier      text    not null,
  amount        numeric not null
);
create index if not exists purchases_date_idx on purchases (purchase_date);

create table if not exists stock_counts (
  id             bigint generated always as identity primary key,
  month          text    not null,
  area           text    not null default '',
  section        text    not null default '',
  item           text    not null,
  uom            text,
  unit_price     numeric not null default 0,
  opening_qty    numeric not null default 0,
  opening_amount numeric not null default 0,
  bought_qty     numeric not null default 0,
  bought_amount  numeric not null default 0,
  closing_qty    numeric not null default 0,
  closing_amount numeric not null default 0
);
create index if not exists stock_counts_month_idx on stock_counts (month);

-- The outlet's item list, by area and category. Stock imports never touch it.
create table if not exists stock_items (
  id         bigint generated always as identity primary key,
  area       text        not null,
  section    text        not null,
  name       text        not null,
  uom        text,
  unit_price numeric     not null default 0,
  sort_order integer     not null default 100000,
  added_by   bigint      references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists stock_items_name_idx on stock_items (upper(trim(name)));
-- Older spellings of the same item in the Stock workbook.
alter table stock_items add column if not exists aliases text[] not null default '{}';

-- ------------------------------------------------------------
-- Daily Report — what the team keys in. Kept apart from daily_sales and purchases,
-- which the POS upload and the Stock 2026 import replace wholesale.
-- ------------------------------------------------------------
create table if not exists daily_reports (
  report_date date        primary key,
  cash        numeric     not null default 0,
  qr          numeric     not null default 0,
  card        numeric     not null default 0,
  updated_by  bigint      references app_users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists daily_purchases (
  id            bigint generated always as identity primary key,
  purchase_date date        not null,
  supplier      text        not null,
  amount        numeric     not null check (amount > 0),
  note          text,
  created_by    bigint      references app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists daily_purchases_date_idx on daily_purchases (purchase_date);
-- The invoice photo in the vault bucket. app/report/actions.ts requires one.
alter table daily_purchases add column if not exists photo_path text;

-- ------------------------------------------------------------
-- Security: server-side only. Your Next.js server uses the SERVICE_ROLE key,
-- which bypasses RLS. Enabling RLS with NO policies means anon/public gets
-- nothing — exactly what we want. Never expose these rows via a public route.
-- ------------------------------------------------------------
alter table records       enable row level security;
alter table agent_actions enable row level security;
alter table agent_runs    enable row level security;
alter table vault_files   enable row level security;
alter table bot_memory    enable row level security;
alter table tg_updates    enable row level security;
alter table app_users     enable row level security;
alter table app_sessions  enable row level security;
alter table daily_sales   enable row level security;
alter table cost_entries  enable row level security;
alter table suppliers     enable row level security;
alter table supplier_products enable row level security;
alter table documents     enable row level security;
alter table app_settings  enable row level security;
alter table shift_types   enable row level security;
alter table roster        enable row level security;
alter table punches       enable row level security;
alter table ot_requests   enable row level security;
alter table chat_messages enable row level security;
alter table outlet_memory enable row level security;
alter table review_links  enable row level security;
alter table review_events enable row level security;
alter table monthly_pnl   enable row level security;
alter table purchases     enable row level security;
alter table stock_counts  enable row level security;
alter table daily_reports enable row level security;
alter table daily_purchases enable row level security;
alter table stock_items   enable row level security;

-- ------------------------------------------------------------
-- Private storage bucket for uploaded photos/PDFs. public=false → the UI can only
-- reach files through short-lived server-generated signed URLs.
-- If your Supabase blocks this insert, create a bucket named "vault" (Public =
-- OFF) in the dashboard Storage tab — 2 clicks. The app shows a calm banner if
-- the bucket is missing.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('vault', 'vault', false)
on conflict (id) do nothing;


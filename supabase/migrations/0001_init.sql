-- Adaptive Scheduling — initial schema
--
-- Conventions that hold everywhere in this file:
--   * Every user-owned table carries user_id uuid -> auth.users(id), with an
--     RLS policy of `user_id = auth.uid()`. That single convention is the
--     whole multi-user story: no multi-user UI ships in Phase 1, but nothing
--     has to be unpicked to add it.
--   * All timestamps are timestamptz. Local-time reasoning happens in the app
--     using profiles.timezone, never in SQL.
--   * Adaptation only ever derives from reasons the user actually stated.
--     There is deliberately nowhere to store an inferred reason.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type block_status as enum (
  'proposed',   -- Claude suggested it; not on any calendar yet
  'committed',  -- written to the planner calendar
  'done',
  'missed',
  'partial',
  'cancelled'
);

create type slot_bucket as enum (
  'early_morning', -- 05:00–07:59
  'morning',       -- 08:00–11:59
  'midday',        -- 12:00–13:59
  'afternoon',     -- 14:00–16:59
  'evening',       -- 17:00–20:59
  'night'          -- 21:00–04:59
);

create type reason_source as enum ('checkin', 'chat');

create type reason_category as enum (
  'sleep',            -- "wasn't awake yet"
  'energy',           -- "too drained after work"
  'time_conflict',    -- something else ran over
  'motivation',
  'underestimated',   -- the task needed more time than booked
  'external',         -- outside his control
  'other'
);

create type rule_directive as enum ('avoid', 'prefer');
create type goal_status as enum ('active', 'achieved', 'abandoned');
create type task_status as enum ('pending', 'scheduled', 'done', 'dropped');
create type checkin_status as enum ('open', 'in_progress', 'completed');
create type chat_kind as enum ('planning', 'checkin');

-- ---------------------------------------------------------------------------
-- Shared trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  -- What the app calls you in the interface. Optional.
  display_name text check (display_name is null or length(display_name) <= 40),

  timezone text not null default 'America/Chicago',

  -- The window the app is ALLOWED to schedule within — not the day job.
  -- Fixed commitments come from the calendar; this is the outer boundary.
  -- Shape: {"1": [{"start": "07:00", "end": "22:00"}], ... "7": [...]}
  -- keyed by ISO weekday. An empty array means "never schedule this day".
  working_hours jsonb not null default '{
    "1": [{"start": "07:00", "end": "22:00"}],
    "2": [{"start": "07:00", "end": "22:00"}],
    "3": [{"start": "07:00", "end": "22:00"}],
    "4": [{"start": "07:00", "end": "22:00"}],
    "5": [{"start": "07:00", "end": "22:00"}],
    "6": [{"start": "09:00", "end": "22:00"}],
    "7": [{"start": "09:00", "end": "22:00"}]
  }'::jsonb,

  -- Minimum gap left between a fixed commitment and a scheduled block.
  buffer_minutes smallint not null default 15 check (buffer_minutes between 0 and 120),

  -- When the weekly check-in becomes available. ISO weekday, 1 = Monday.
  checkin_weekday smallint not null default 7 check (checkin_weekday between 1 and 7),
  checkin_hour smallint not null default 18 check (checkin_hour between 0 and 23),

  -- Opaque provider id of the calendar the app writes to (CalDAV: collection URL).
  planner_calendar_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Give every new auth user a profile so no code path has to handle its absence.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Calendar connection
-- ---------------------------------------------------------------------------

-- Apple offers no OAuth for CalDAV, so this holds an app-specific password.
-- It is encrypted AES-256-GCM with APP_ENCRYPTION_KEY before it ever reaches
-- the database, and is only ever decrypted in server-side code.
create table public.calendar_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  apple_id text not null,
  encrypted_password text not null,
  iv text not null,
  auth_tag text not null,
  principal_url text,
  calendar_home_url text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger calendar_credentials_updated_at
  before update on public.calendar_credentials
  for each row execute function public.set_updated_at();

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,          -- CalDAV collection URL
  display_name text not null,
  color text,
  is_planner boolean not null default false,
  read_enabled boolean not null default true,
  sync_token text,                    -- CalDAV sync-collection token
  ctag text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id)
);

create trigger calendars_updated_at
  before update on public.calendars
  for each row execute function public.set_updated_at();

-- At most one planner calendar per user.
create unique index calendars_one_planner_per_user
  on public.calendars (user_id) where is_planner;

-- ---------------------------------------------------------------------------
-- Cached fixed commitments
-- ---------------------------------------------------------------------------

-- Local mirror of the user's real events, so slot finding is a DB query
-- rather than a CalDAV round trip. Rebuilt from sync tokens; never a source
-- of truth.
create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  uid text not null,
  etag text,
  title text not null default '(busy)',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  -- Expanded instances of a recurring master share a UID, so starts_at is
  -- part of the natural key.
  recurring boolean not null default false,
  location text,
  synced_at timestamptz not null default now(),
  unique (calendar_id, uid, starts_at),
  check (ends_at > starts_at)
);

create index external_events_window
  on public.external_events (user_id, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Goals and tasks
-- ---------------------------------------------------------------------------

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,                 -- "Make 4 AI videos"
  description text,
  target_count integer check (target_count > 0),
  period_start date not null,
  period_end date not null,
  status goal_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create trigger goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

create index goals_active on public.goals (user_id, status, period_start);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  title text not null,
  -- The axis adaptation learns on. A specific task disappears once it's done;
  -- the type persists, which is what makes "7am editing never works" learnable.
  -- Normalised slug: 'editing', 'filming', 'scripting', 'gym'.
  task_type text not null,
  estimated_minutes integer not null default 60 check (estimated_minutes between 5 and 720),
  status task_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (task_type = lower(task_type))
);

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create index tasks_by_type on public.tasks (user_id, task_type);
create index tasks_open on public.tasks (user_id, status);

-- ---------------------------------------------------------------------------
-- Scheduled blocks
-- ---------------------------------------------------------------------------

create table public.scheduled_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,

  planned_start timestamptz not null,
  planned_end timestamptz not null,

  status block_status not null default 'proposed',

  -- Denormalised at write time so a reason survives the task being deleted
  -- and so adaptation queries never need a join back through tasks.
  task_type text not null,
  bucket slot_bucket not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),

  -- Populated once written to the planner calendar.
  caldav_uid text,
  caldav_etag text,
  committed_at timestamptz,

  completed_at timestamptz,
  -- Free-text note the user attached when marking it done/partial.
  completion_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (planned_end > planned_start),
  -- A block is on the calendar iff it has a UID.
  check ((status = 'proposed') = (caldav_uid is null))
);

create trigger scheduled_blocks_updated_at
  before update on public.scheduled_blocks
  for each row execute function public.set_updated_at();

create index scheduled_blocks_window
  on public.scheduled_blocks (user_id, planned_start);
create index scheduled_blocks_unresolved
  on public.scheduled_blocks (user_id, status, planned_start);
create unique index scheduled_blocks_caldav_uid
  on public.scheduled_blocks (user_id, caldav_uid) where caldav_uid is not null;

-- ---------------------------------------------------------------------------
-- Weekly check-ins and stated reasons
-- ---------------------------------------------------------------------------

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status checkin_status not null default 'open',
  -- Full conversation, kept so a reason can always be read back in context.
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_start),
  check (period_end >= period_start)
);

create trigger checkins_updated_at
  before update on public.checkins
  for each row execute function public.set_updated_at();

-- The heart of the app. reason_text holds the user's own words, verbatim —
-- adaptation quotes it back rather than paraphrasing.
create table public.reasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_block_id uuid references public.scheduled_blocks(id) on delete set null,
  checkin_id uuid references public.checkins(id) on delete set null,

  -- Copied from the block so the reason outlives it.
  task_type text not null,
  bucket slot_bucket not null,
  day_of_week smallint check (day_of_week between 1 and 7),

  reason_text text not null,
  category reason_category not null default 'other',
  source reason_source not null default 'checkin',
  stated_at timestamptz not null default now()
);

create index reasons_pattern
  on public.reasons (user_id, task_type, bucket);

-- ---------------------------------------------------------------------------
-- Adaptation rules
-- ---------------------------------------------------------------------------

-- Derived deterministically from `reasons` (>= 2 matching stated reasons).
-- Every row must point back at the reasons that produced it, so the planner
-- can say why it moved something and the user can audit or switch it off.
create table public.adaptation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_type text not null,
  bucket slot_bucket not null,
  day_of_week smallint check (day_of_week between 1 and 7),
  directive rule_directive not null default 'avoid',
  confidence_count integer not null default 0 check (confidence_count >= 0),
  derived_from_reason_ids uuid[] not null default '{}',
  -- Human-readable justification quoting the stated reasons.
  rationale text,
  active boolean not null default true,
  -- Set when the user switches a rule off, so derivation won't resurrect it.
  muted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(derived_from_reason_ids) > 0 or confidence_count = 0)
);

create trigger adaptation_rules_updated_at
  before update on public.adaptation_rules
  for each row execute function public.set_updated_at();

-- One rule per (task type, bucket, weekday). COALESCE so the "any weekday"
-- rule (null day_of_week) does not collide with weekday-specific ones.
create unique index adaptation_rules_unique_slot
  on public.adaptation_rules (user_id, task_type, bucket, coalesce(day_of_week, 0));

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind chat_kind not null,
  checkin_id uuid references public.checkins(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();

create index chat_sessions_recent on public.chat_sessions (user_id, kind, created_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Anthropic content blocks verbatim, so tool_use/tool_result round-trip.
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index chat_messages_by_session on public.chat_messages (session_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.calendar_credentials  enable row level security;
alter table public.calendars             enable row level security;
alter table public.external_events       enable row level security;
alter table public.goals                 enable row level security;
alter table public.tasks                 enable row level security;
alter table public.scheduled_blocks      enable row level security;
alter table public.checkins              enable row level security;
alter table public.reasons               enable row level security;
alter table public.adaptation_rules      enable row level security;
alter table public.chat_sessions         enable row level security;
alter table public.chat_messages         enable row level security;

create policy "own profile" on public.profiles
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- calendar_credentials is keyed by user_id as its primary key.
create policy "own credentials" on public.calendar_credentials
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own calendars" on public.calendars
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own external events" on public.external_events
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own goals" on public.goals
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own tasks" on public.tasks
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own scheduled blocks" on public.scheduled_blocks
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own checkins" on public.checkins
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own reasons" on public.reasons
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own adaptation rules" on public.adaptation_rules
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own chat sessions" on public.chat_sessions
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own chat messages" on public.chat_messages
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

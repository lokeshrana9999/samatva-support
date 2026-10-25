-- Step 1: the sessions table (docs/design.md, data model). Server-held stage,
-- turn counts and locks; no message text, no IP hash.

create table if not exists public.sessions (
  id                 uuid primary key,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  stage              text not null check (stage in ('intake',
                     'understand','recommend','close','handoff')),
  risk_floor         text not null default 'none'
                     check (risk_floor in ('none','elevated')),
  user_turns         int  not null default 0,
  understand_turns   int  not null default 0,
  needs              jsonb not null default '{}',
  history_mac        text,
  being_harmed       boolean not null default false,
  transcript_consent boolean not null,
  version            int  not null default 0
);

create index if not exists sessions_last_seen_at_idx on public.sessions (last_seen_at);

-- RLS on with no policies: the anon and authenticated roles read nothing.
-- Only the service-role key, used server-side, can reach the table (D34).
alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;

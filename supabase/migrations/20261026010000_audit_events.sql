-- Step 2: the content-free audit log (docs/design.md, audit_events). No column
-- can hold message text: every field is an enum, a number, an id or a name
-- from a fixed list. Kept 90 days (the purge job lands in step 5).

create table if not exists public.audit_events (
  id                bigint generated always as identity primary key,
  at                timestamptz not null default now(),
  session_id        uuid not null,
  reviewer_hash     text not null,
  turn              int  not null,
  stage_in          text not null,
  stage_out         text not null,
  risk_keyword      text,
  keyword_pattern   text,
  risk_jev          text,
  risk_jev_p        jsonb,
  risk_final        text not null,
  filter_violations text[] not null default '{}',
  regenerated       boolean not null default false,
  stock_fallback    boolean not null default false,
  tools             text[] not null default '{}',
  tool_rejected     boolean not null default false,
  provider          text,
  model             text,
  jev_model         text,
  tokens_in         int,
  tokens_out        int,
  cost_usd          numeric(10,6),
  latency_ms        int,
  outcome           text not null
                    check (outcome in ('ok','handoff','limit','error'))
);

create index if not exists audit_events_at_idx on public.audit_events (at);
create index if not exists audit_events_session_idx on public.audit_events (session_id);
create index if not exists audit_events_reviewer_at_idx on public.audit_events (reviewer_hash, at);

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;

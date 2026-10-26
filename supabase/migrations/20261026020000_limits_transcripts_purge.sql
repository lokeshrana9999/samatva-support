-- Step 5: rate and spend limits, consented transcripts, and the purge jobs
-- (docs/design.md, data model).

-- Limits: one row per bucket and window. One upsert both checks and adds, so
-- two concurrent turns can't both slip under a cap (D36).
create table if not exists public.limits (
  bucket       text not null,
  window_start timestamptz not null,
  amount       numeric not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.consume_limit(p_bucket text, p_window timestamptz,
                                                p_add numeric, p_cap numeric)
returns boolean
language sql
security definer
set search_path = public
as $$
  insert into public.limits as l (bucket, window_start, amount)
  values (p_bucket, p_window, p_add)
  on conflict (bucket, window_start)
  do update set amount = l.amount + p_add
  where l.amount + p_add <= p_cap
  returning true;
$$;  -- null result = cap hit

-- Transcripts: written only when the session's consent is true, checked in
-- the database as well as in the app (design, transcripts).
create table if not exists public.transcripts (
  session_id uuid not null,
  seq        int  not null,
  role       text not null check (role in ('user','assistant')),
  text       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (session_id, seq)
);
create index if not exists transcripts_expires_at_idx on public.transcripts (expires_at);

create or replace function public.append_transcript(p_session uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  if not exists (select 1 from public.sessions where id = p_session and transcript_consent) then
    return 0;
  end if;
  insert into public.transcripts (session_id, seq, role, text)
  select p_session, (r->>'seq')::int, r->>'role', r->>'text'
  from jsonb_array_elements(p_rows) as r
  on conflict (session_id, seq) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- RLS on with no policies, and the functions closed to the API roles:
-- PostgREST exposes functions too (D34).
alter table public.limits enable row level security;
alter table public.transcripts enable row level security;
revoke all on public.limits, public.transcripts from anon, authenticated;
revoke execute on function public.consume_limit(text, timestamptz, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.append_transcript(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.consume_limit(text, timestamptz, numeric, numeric) to service_role;
grant execute on function public.append_transcript(uuid, jsonb) to service_role;

-- Purges run inside the database, so there is no public endpoint to protect
-- (D37).
create extension if not exists pg_cron;

select cron.unschedule(jobname) from cron.job
where jobname in ('purge-transcripts', 'purge-sessions', 'purge-limits', 'purge-audit');

select cron.schedule('purge-transcripts', '7 * * * *',
  $$delete from public.transcripts where expires_at < now()$$);
select cron.schedule('purge-sessions', '17 * * * *',
  $$delete from public.sessions where last_seen_at < now() - interval '24 hours'$$);
select cron.schedule('purge-limits', '27 3 * * *',
  $$delete from public.limits where window_start < now() - interval '2 days'$$);
select cron.schedule('purge-audit', '37 3 * * *',
  $$delete from public.audit_events where at < now() - interval '90 days'$$);

-- VTM Angebotsdesk · Einmaliges Backend-Setup
-- In Supabase: SQL Editor öffnen, dieses Script einfügen, "Run".
-- (Identisch mit dem Script in der App unter Einstellungen →
--  Team-Synchronisation → Einmalige Einrichtung.)

create table if not exists public.desk_state (
  id text primary key,
  rev bigint not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.desk_state enable row level security;

drop policy if exists "team access" on public.desk_state;
create policy "team access" on public.desk_state
  for all to anon using (true) with check (true);

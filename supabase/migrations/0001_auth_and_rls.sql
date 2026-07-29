-- Auth wiring, row-level security and realtime.
--
-- Run this in the Supabase SQL editor AFTER `npm run db:push` has created the
-- tables. Drizzle deliberately does not manage any of this: the `auth` schema
-- belongs to Supabase, and RLS policies are security-critical enough that they
-- should be reviewed as explicit SQL rather than generated.
--
-- Threat model: NEXT_PUBLIC_SUPABASE_ANON_KEY ships to every browser, so every
-- table below must assume a hostile client holding a valid anon key and, after
-- login, a valid JWT for some user. RLS is the only thing standing between that
-- client and other users' data.

-- ---------------------------------------------------------------------------
-- 1. Link public.users to auth.users and auto-create a profile on signup
-- ---------------------------------------------------------------------------

alter table public.users
  drop constraint if exists users_id_fkey;

alter table public.users
  add constraint users_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.users                   enable row level security;
alter table public.user_api_keys           enable row level security;
alter table public.ai_usage                enable row level security;
alter table public.podcasts                enable row level security;
alter table public.episodes                enable row level security;
alter table public.subscriptions           enable row level security;
alter table public.playback_state          enable row level security;
alter table public.queue_items             enable row level security;
alter table public.downloads               enable row level security;
alter table public.ai_jobs                 enable row level security;
alter table public.transcripts             enable row level security;
alter table public.summaries               enable row level security;
alter table public.listening_history       enable row level security;
alter table public.recommendation_feedback enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Profile: own row only
-- ---------------------------------------------------------------------------

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated using (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 4. Secrets and quota: no client access at all
--
-- RLS is enabled with zero policies, so `authenticated` and `anon` are denied
-- outright. service_role bypasses RLS, so only our server routes can read or
-- write these. BYOK ciphertext and quota counters must never be client-visible
-- or client-writable — a user could otherwise reset their own daily quota.
-- ---------------------------------------------------------------------------

-- public.user_api_keys : intentionally no policies
-- public.ai_usage      : intentionally no policies

-- ---------------------------------------------------------------------------
-- 5. Shared catalog cache: world-readable, server-written
--
-- Show and episode metadata is public information republished from RSS, and
-- transcripts/summaries are cached per episode so one user's generation job
-- benefits everyone. Writes go through the server (service_role) so a client
-- cannot poison the shared cache.
-- ---------------------------------------------------------------------------

drop policy if exists podcasts_read_all on public.podcasts;
create policy podcasts_read_all on public.podcasts
  for select to authenticated using (true);

drop policy if exists episodes_read_all on public.episodes;
create policy episodes_read_all on public.episodes
  for select to authenticated using (true);

drop policy if exists transcripts_read_all on public.transcripts;
create policy transcripts_read_all on public.transcripts
  for select to authenticated using (true);

drop policy if exists summaries_read_all on public.summaries;
create policy summaries_read_all on public.summaries
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 6. Per-user library: full CRUD on own rows only
-- ---------------------------------------------------------------------------

drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists playback_state_own on public.playback_state;
create policy playback_state_own on public.playback_state
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists queue_items_own on public.queue_items;
create policy queue_items_own on public.queue_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists downloads_own on public.downloads;
create policy downloads_own on public.downloads
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists listening_history_own on public.listening_history;
create policy listening_history_own on public.listening_history
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists recommendation_feedback_own on public.recommendation_feedback;
create policy recommendation_feedback_own on public.recommendation_feedback
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- AI jobs: readable by their owner (so the progress UI can subscribe via
-- Realtime), but only the server may create or advance them — otherwise a
-- client could forge a 'done' status or enqueue work past its quota.
drop policy if exists ai_jobs_select_own on public.ai_jobs;
create policy ai_jobs_select_own on public.ai_jobs
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. Realtime: cross-device sync
--
-- Realtime respects RLS, so each client only receives changes to its own rows.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.playback_state;
alter publication supabase_realtime add table public.queue_items;
alter publication supabase_realtime add table public.ai_jobs;

-- Realtime needs the full previous row to compute deletes/updates for tables
-- whose primary key is composite.
alter table public.playback_state replica identity full;
alter table public.queue_items    replica identity full;

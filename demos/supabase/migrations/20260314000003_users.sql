-- User profiles (extends Supabase auth.users)

create table if not exists public.user_profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  full_name             text not null,
  email                 text not null,
  identification_type   text references public.identification_types(slug),
  identification_number text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create index if not exists user_profiles_full_name_idx
  on public.user_profiles using gin(to_tsvector('simple', full_name));

create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function update_updated_at();

alter table public.user_profiles enable row level security;

-- Users can read their own profile
-- Note: deleted_at filtering is done at the application level, not in RLS.
-- Including it here would cause PostgreSQL to reject soft-delete UPDATEs,
-- because PG evaluates SELECT policies against the NEW row during UPDATE.
create policy "users can read own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

-- Users can update their own profile (with check allows soft delete)
create policy "users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id and deleted_at is null)
  with check (auth.uid() = id);

-- Service role has full access (used by auth function to create profiles)
create policy "service role full access"
  on public.user_profiles for all
  using (auth.role() = 'service_role');

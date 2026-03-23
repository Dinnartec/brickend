-- Entities (companies/persons with tax identification)

create table if not exists public.entities (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  identification_type   text not null references public.identification_types(slug),
  identification_number text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

-- Unique identification per owner (ignoring soft-deleted)
create unique index if not exists entities_owner_identification_unique_idx
  on public.entities (owner_id, identification_type, identification_number)
  where deleted_at is null;

-- Full-text search on name
create index if not exists entities_name_gin_idx
  on public.entities using gin(to_tsvector('simple', name));

create trigger entities_updated_at
  before update on public.entities
  for each row execute function update_updated_at();

alter table public.entities enable row level security;

-- Owners can read their own entities
-- Note: deleted_at filtering is done at the application level, not in RLS.
-- Including it here would cause PostgreSQL to reject soft-delete UPDATEs,
-- because PG evaluates SELECT policies against the NEW row during UPDATE.
create policy "owners can read own entities"
  on public.entities for select
  using (auth.uid() = owner_id);

-- Owners can insert their own entities
create policy "owners can insert own entities"
  on public.entities for insert
  with check (auth.uid() = owner_id);

-- Owners can update their own non-deleted entities (with check allows soft delete)
create policy "owners can update own entities"
  on public.entities for update
  using (auth.uid() = owner_id and deleted_at is null)
  with check (auth.uid() = owner_id);

-- Service role has full access
create policy "service role full access"
  on public.entities for all
  using (auth.role() = 'service_role');

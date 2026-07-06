-- palmós: projects table + owner-scoped storage.
-- Reviewed per database-schema-designer: cascade on user delete, composite
-- index for the list query, updated_at trigger, full RLS policy set,
-- jsonb size guard, owner-scoped storage policies.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null default 'untitled',
  scene jsonb not null,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- keep abusive payloads out; typical scenes are 10KB–1MB
  constraint scene_size_limit check (pg_column_size(scene) < 5 * 1024 * 1024)
);

-- the project-list query: where owner = ? order by updated_at desc
create index if not exists projects_owner_updated_at_idx
  on public.projects (owner, updated_at desc);

-- touch updated_at on every write
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch_updated_at
  before update on public.projects
  for each row
  execute function public.touch_updated_at();

-- owner-only read/write
alter table public.projects enable row level security;

create policy "projects_select_own" on public.projects
  for select using (auth.uid() = owner);

create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = owner);

create policy "projects_update_own" on public.projects
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = owner);

-- storage: source screenshots at uploads/{user_id}/...
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

create policy "uploads_select_own" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads_delete_own" on storage.objects
  for delete using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

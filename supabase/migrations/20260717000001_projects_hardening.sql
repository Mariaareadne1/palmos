-- palmós: projects hardening (database-review follow-up).
-- Additive migration — safe to apply on top of 20260706000001_projects.sql.
-- Addresses: compression-sensitive size guard, per-row auth.uid() in RLS,
-- unscoped policies, missing storage bucket limits + UPDATE policy, and a
-- couple of linter-flagged hygiene items.

-- 1) HIGH: the original size guard used pg_column_size(), which measures the
--    TOAST-compressed on-disk size; a highly compressible scene can be many
--    MB of JSON yet report well under 5MB. Measure the logical size instead.
alter table public.projects drop constraint if exists scene_size_limit;
alter table public.projects
  add constraint scene_size_limit check (octet_length(scene::text) < 5 * 1024 * 1024);

-- 2) LOW: basic length hygiene on the display name.
alter table public.projects drop constraint if exists projects_name_length;
alter table public.projects
  add constraint projects_name_length check (char_length(name) between 1 and 200);

-- 3) HIGH (perf) + MEDIUM (scoping): wrap auth.uid() in a scalar subselect so
--    Postgres caches it once per statement (initplan) instead of calling it
--    per row, and scope every policy to `authenticated` so it isn't evaluated
--    for the anon role (which can never satisfy it anyway).
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select to authenticated
  using ((select auth.uid()) = owner);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert to authenticated
  with check ((select auth.uid()) = owner);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update to authenticated
  using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete to authenticated
  using ((select auth.uid()) = owner);

-- 4) MEDIUM: cap upload size and restrict content type at the storage layer,
--    independent of the RLS ownership check.
update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'uploads';

-- 5) Recreate storage policies scoped to `authenticated` with the cached
--    auth.uid(), and add the previously-missing UPDATE policy so an
--    upsert/replace of a screenshot isn't silently blocked by RLS.
drop policy if exists "uploads_select_own" on storage.objects;
create policy "uploads_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "uploads_insert_own" on storage.objects;
create policy "uploads_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "uploads_update_own" on storage.objects;
create policy "uploads_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "uploads_delete_own" on storage.objects;
create policy "uploads_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 6) LOW: pin search_path on the trigger function (linter:
--    function_search_path_mutable). Harmless today, but explicit is better.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

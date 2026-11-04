-- Run this once in Supabase Dashboard > SQL Editor.
-- The browser app uses only the public publishable/anon key. Row Level Security
-- and the storage policies below ensure each signed-in user can access only
-- their own workspace and files.

create table if not exists public.workspace_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

drop policy if exists "Users can access their own workspace" on public.workspace_state;
create policy "Users can access their own workspace"
  on public.workspace_state
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.workspace_state to authenticated;

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'project-files';

drop policy if exists "Users can read their own project files" on storage.objects;
create policy "Users can read their own project files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can upload their own project files" on storage.objects;
create policy "Users can upload their own project files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their own project files" on storage.objects;
create policy "Users can update their own project files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own project files" on storage.objects;
create policy "Users can delete their own project files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

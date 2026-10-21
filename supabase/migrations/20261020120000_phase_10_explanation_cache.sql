-- Cached explanations are isolated by organization and analysis. The exact
-- model snapshot and content fingerprint are part of the uniqueness key.
create table public.explanation_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  target_kind text not null check (target_kind in ('file', 'folder')),
  target_path text not null,
  content_hash text not null,
  model_name text not null,
  content text not null,
  ai_role text check (ai_role is null or ai_role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')),
  created_at timestamptz not null default now(),
  unique (organization_id, analysis_id, target_kind, target_path, content_hash, model_name)
);

create index explanation_cache_analysis_target_idx
  on public.explanation_cache (organization_id, analysis_id, target_kind, target_path);

alter table public.explanation_cache enable row level security;

create policy "explanation cache scoped to current org"
on public.explanation_cache
as restrictive
for all
to authenticated
using (organization_id = coalesce(
  auth.jwt() -> 'o' ->> 'id',
  auth.jwt() ->> 'org_id',
  auth.jwt() ->> 'https://www.clerk.com/claims/org_id'
))
with check (organization_id = coalesce(
  auth.jwt() -> 'o' ->> 'id',
  auth.jwt() ->> 'org_id',
  auth.jwt() ->> 'https://www.clerk.com/claims/org_id'
));

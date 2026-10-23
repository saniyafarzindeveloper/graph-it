-- Keep explanation records tied to the exact prompt and context used, so
-- deterministic path checks can validate later comparisons against that set.
alter table public.explanation_cache
  add column prompt_version text not null default 'v1',
  add column source_paths jsonb,
  add column relationships jsonb,
  add column path_check jsonb;

alter table public.explanation_cache
  drop constraint if exists explanation_cache_organization_id_analysis_id_target_kind_target_path_content_hash_model_name_key;

alter table public.explanation_cache
  add constraint explanation_cache_prompt_snapshot_unique
  unique (organization_id, analysis_id, target_kind, target_path, content_hash, model_name, prompt_version);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  eval_type text not null check (eval_type in ('role_accuracy', 'prompt_comparison')),
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

create index eval_runs_org_type_created_idx
  on public.eval_runs (organization_id, eval_type, created_at desc);

alter table public.eval_runs enable row level security;

create policy "evaluation runs scoped to current org"
on public.eval_runs
as permissive
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

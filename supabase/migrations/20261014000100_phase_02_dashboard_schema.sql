create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id text primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  status text not null default 'queued',
  summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  path text not null,
  language text,
  size_bytes bigint default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  source_file_id uuid not null references public.files(id) on delete cascade,
  target_file_id uuid not null references public.files(id) on delete cascade,
  kind text not null default 'import',
  created_at timestamptz not null default now()
);

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  path text not null,
  method text not null default 'GET',
  created_at timestamptz not null default now()
);

create table if not exists public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  role_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  title text not null,
  description text not null,
  confidence numeric(4,3) default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_organization_id on public.projects(organization_id);
create index if not exists idx_analyses_organization_id on public.analyses(organization_id);
create index if not exists idx_analyses_project_id on public.analyses(project_id);
create index if not exists idx_files_organization_id on public.files(organization_id);
create index if not exists idx_edges_organization_id on public.edges(organization_id);
create index if not exists idx_routes_organization_id on public.routes(organization_id);
create index if not exists idx_explanations_organization_id on public.explanations(organization_id);
create index if not exists idx_file_roles_organization_id on public.file_roles(organization_id);
create index if not exists idx_insights_organization_id on public.insights(organization_id);

alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.analyses enable row level security;
alter table public.files enable row level security;
alter table public.edges enable row level security;
alter table public.routes enable row level security;
alter table public.explanations enable row level security;
alter table public.file_roles enable row level security;
alter table public.insights enable row level security;

create policy "organizations scoped to current org"
on public.organizations
as restrictive
for all
to authenticated
using (id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "projects scoped to current org"
on public.projects
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "analyses scoped to current org"
on public.analyses
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "files scoped to current org"
on public.files
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "edges scoped to current org"
on public.edges
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "routes scoped to current org"
on public.routes
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "explanations scoped to current org"
on public.explanations
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "file roles scoped to current org"
on public.file_roles
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

create policy "insights scoped to current org"
on public.insights
as restrictive
for all
to authenticated
using (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

insert into public.organizations (id, name, slug)
values
  ('org_alpha', 'Alpha Workspace', 'alpha'),
  ('org_beta', 'Beta Workspace', 'beta')
on conflict (id) do nothing;

insert into public.projects (id, organization_id, name, description)
values
  ('c4e85b7d-0d0d-4684-9e34-2ea5d18522d4', 'org_alpha', 'Alpha repository', 'Seeded project for the alpha organization.'),
  ('842a29be-baf6-4a8d-8aba-d49bd4ad7c4b', 'org_beta', 'Beta repository', 'Seeded project for the beta organization.')
on conflict (id) do nothing;

insert into public.analyses (id, organization_id, project_id, name, status, summary)
values
  ('d667003a-b7d1-4d55-abdd-c6fd0b658d5c', 'org_alpha', 'c4e85b7d-0d0d-4684-9e34-2ea5d18522d4', 'Alpha mapping', 'completed', 'Seeded analysis for the alpha workspace.'),
  ('2d61f908-03a9-4ee4-a2ae-8be7a6d19125', 'org_beta', '842a29be-baf6-4a8d-8aba-d49bd4ad7c4b', 'Beta mapping', 'running', 'Seeded analysis for the beta workspace.')
on conflict (id) do nothing;

insert into public.files (id, organization_id, analysis_id, path, language, size_bytes)
values
  ('a5800371-b7a2-4d56-98c7-f4519dd4ad2c', 'org_alpha', 'd667003a-b7d1-4d55-abdd-c6fd0b658d5c', 'src/app/page.tsx', 'ts', 1280),
  ('2f2d43ad-94d1-4fe8-8ec5-3ac1551f1ea2', 'org_beta', '2d61f908-03a9-4ee4-a2ae-8be7a6d19125', 'src/app/layout.tsx', 'ts', 920)
on conflict (id) do nothing;

insert into public.edges (id, organization_id, analysis_id, source_file_id, target_file_id, kind)
values
  ('b6da21e6-1e17-4dff-bf02-1dfcdfb34d72', 'org_alpha', 'd667003a-b7d1-4d55-abdd-c6fd0b658d5c', 'a5800371-b7a2-4d56-98c7-f4519dd4ad2c', 'a5800371-b7a2-4d56-98c7-f4519dd4ad2c', 'self'),
  ('0a1d0d1f-9d9d-4a46-9b65-c320c1d9b1be', 'org_beta', '2d61f908-03a9-4ee4-a2ae-8be7a6d19125', '2f2d43ad-94d1-4fe8-8ec5-3ac1551f1ea2', '2f2d43ad-94d1-4fe8-8ec5-3ac1551f1ea2', 'self')
on conflict (id) do nothing;

insert into public.routes (id, organization_id, analysis_id, path, method)
values
  ('6e980117-aaf6-4693-9a22-0cc0f26e82cf', 'org_alpha', 'd667003a-b7d1-4d55-abdd-c6fd0b658d5c', '/', 'GET'),
  ('8f9a17d9-8c1d-4c06-9d6f-7f0fe9b12ea5', 'org_beta', '2d61f908-03a9-4ee4-a2ae-8be7a6d19125', '/dashboard', 'GET')
on conflict (id) do nothing;

insert into public.explanations (id, organization_id, analysis_id, title, content)
values
  ('b4ae15d7-a8aa-4e70-bf58-bd9f58e8d4f0', 'org_alpha', 'd667003a-b7d1-4d55-abdd-c6fd0b658d5c', 'Entry point', 'The app loads a root page and renders the workspace shell.'),
  ('f7d1ca18-5d4b-4fdd-93f2-b21d1cd908df', 'org_beta', '2d61f908-03a9-4ee4-a2ae-8be7a6d19125', 'Dashboard route', 'The dashboard reads organization state and lists analyses for the current team.')
on conflict (id) do nothing;

insert into public.file_roles (id, organization_id, file_id, role_name)
values
  ('65bf2f9d-803f-4dfe-9ff7-66e3d1dd6f1d', 'org_alpha', 'a5800371-b7a2-4d56-98c7-f4519dd4ad2c', 'entrypoint'),
  ('c6be4b66-5bb9-4e93-b0d2-f8464a3d1fec', 'org_beta', '2f2d43ad-94d1-4fe8-8ec5-3ac1551f1ea2', 'layout')
on conflict (id) do nothing;

insert into public.insights (id, organization_id, analysis_id, title, description, confidence)
values
  ('7db0414a-2751-4cb0-8a8c-06db35d21fd3', 'org_alpha', 'd667003a-b7d1-4d55-abdd-c6fd0b658d5c', 'Workspace detected', 'The repository has a single auth-backed workspace shell.', 0.96),
  ('d7d02368-4551-4f69-b38a-6c0d6483bb34', 'org_beta', '2d61f908-03a9-4ee4-a2ae-8be7a6d19125', 'Org aware route', 'The dashboard changes with the active organization context.', 0.91)
on conflict (id) do nothing;

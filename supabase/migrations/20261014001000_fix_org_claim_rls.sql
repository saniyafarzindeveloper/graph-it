drop policy if exists "organizations scoped to current org" on public.organizations;
drop policy if exists "projects scoped to current org" on public.projects;
drop policy if exists "analyses scoped to current org" on public.analyses;
drop policy if exists "files scoped to current org" on public.files;
drop policy if exists "edges scoped to current org" on public.edges;
drop policy if exists "routes scoped to current org" on public.routes;
drop policy if exists "explanations scoped to current org" on public.explanations;
drop policy if exists "file roles scoped to current org" on public.file_roles;
drop policy if exists "insights scoped to current org" on public.insights;

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

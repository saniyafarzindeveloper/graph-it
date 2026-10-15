alter policy "organizations scoped to current org"
on public.organizations
using (id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "projects scoped to current org"
on public.projects
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "analyses scoped to current org"
on public.analyses
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "files scoped to current org"
on public.files
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "edges scoped to current org"
on public.edges
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "routes scoped to current org"
on public.routes
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "explanations scoped to current org"
on public.explanations
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "file roles scoped to current org"
on public.file_roles
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

alter policy "insights scoped to current org"
on public.insights
using (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'))
with check (organization_id = coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id', auth.jwt() ->> 'https://www.clerk.com/claims/org_id'));

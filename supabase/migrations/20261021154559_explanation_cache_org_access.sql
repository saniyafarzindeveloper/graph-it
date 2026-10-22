-- A restrictive policy can only narrow access already granted by a
-- permissive policy. Keep the organization check as the table's permissive
-- grant so authenticated organization members can read and upsert their cache.
drop policy if exists "explanation cache scoped to current org"
  on public.explanation_cache;

create policy "explanation cache scoped to current org"
on public.explanation_cache
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

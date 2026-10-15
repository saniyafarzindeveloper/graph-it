insert into public.organizations (id, name, slug)
values ('org_3Kgyz6TB37sNeM6yhW60h5X61gZ', 'Saniya Farzin', 'saniya-farzin')
on conflict (id) do nothing;

update public.projects
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.analyses
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.files
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.edges
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.routes
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.explanations
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.file_roles
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

update public.insights
set organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ'
where organization_id = 'org_alpha';

delete from public.organizations
where id = 'org_alpha';

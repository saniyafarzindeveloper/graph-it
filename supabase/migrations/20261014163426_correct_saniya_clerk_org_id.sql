insert into public.organizations (id, name, slug)
values (
	'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
	'Saniya Farzin',
	'saniya-farzin-1791993764189438285'
)
on conflict (id) do nothing;

update public.projects
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.analyses
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.files
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.edges
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.routes
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.explanations
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.file_roles
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

update public.insights
set organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ'
where organization_id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

delete from public.organizations
where id = 'org_3Kgyz6TB37sNeM6yhW60h5X61gZ';

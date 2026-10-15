update public.projects
set name = 'vercel/next.js',
		description = 'Sample repository shown in the dashboard example.',
		updated_at = now()
where id = 'c4e85b7d-0d0d-4684-9e34-2ea5d18522d4';

update public.analyses
set name = 'vercel/next.js',
		status = 'completed',
		summary = 'Commit 4f1c2a9',
		created_at = now() - interval '3 days',
		completed_at = now() - interval '3 days'
where id = 'd667003a-b7d1-4d55-abdd-c6fd0b658d5c'
	and organization_id = 'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ';

insert into public.projects (id, organization_id, name, description)
values
	(
		'b2000000-0000-4000-8000-000000000001',
		'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
		'tailwindlabs/tailwindcss',
		'Sample repository shown in the dashboard example.'
	),
	(
		'b2000000-0000-4000-8000-000000000002',
		'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
		'shadcn-ui/ui',
		'Sample repository shown in the dashboard example.'
	)
on conflict (id) do nothing;

insert into public.analyses (
	id,
	organization_id,
	project_id,
	name,
	status,
	summary,
	created_at,
	completed_at
)
values
	(
		'b1000000-0000-4000-8000-000000000001',
		'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
		'c4e85b7d-0d0d-4684-9e34-2ea5d18522d4',
		'vercel/next.js',
		'parsing',
		'Commit a93be01',
		now() - interval '21 minutes',
		null
	),
	(
		'b1000000-0000-4000-8000-000000000002',
		'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
		'b2000000-0000-4000-8000-000000000002',
		'shadcn-ui/ui',
		'failed',
		'Repository archive download timed out',
		now() - interval '5 hours',
		now() - interval '5 hours'
	),
	(
		'b1000000-0000-4000-8000-000000000003',
		'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
		'b2000000-0000-4000-8000-000000000002',
		'shadcn-ui/ui',
		'completed',
		'Commit 0c7d9e2',
		now() - interval '24 hours',
		now() - interval '24 hours'
	),
	(
		'b1000000-0000-4000-8000-000000000004',
		'org_3Kgyz6TB37sNeM6yhW6Oh5X61gZ',
		'b2000000-0000-4000-8000-000000000001',
		'tailwindlabs/tailwindcss',
		'queued',
		null,
		now() - interval '20 minutes',
		null
	)
on conflict (id) do nothing;

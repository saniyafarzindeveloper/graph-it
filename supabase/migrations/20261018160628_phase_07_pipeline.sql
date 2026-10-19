-- Repository identity belongs to the organization and is unique within it.
alter table public.projects add column repository_url text;
create unique index projects_org_repository_url_unique
  on public.projects (organization_id, repository_url)
  where repository_url is not null;

alter table public.analyses
  add column repository_key text,
  add column commit_sha text,
  add column stage text,
  add column stage_message text,
  add column failed_stage text,
  add column error_message text,
  add column coverage jsonb,
  add column folder_count integer;

create unique index analyses_org_repository_key_unique
  on public.analyses (organization_id, repository_key)
  where repository_key is not null;

alter table public.files
  add column folder text not null default '.',
  add column extension text,
  add column line_count integer,
  add column content_hash text,
  add column module_name text,
  add column fan_in integer not null default 0,
  add column fan_out integer not null default 0;

alter table public.edges
  add column specifier text,
  add column resolution text,
  add column reason text;

-- Progress messages contain only the stage and its short message. The
-- organization check on private channels mirrors the row-level data policy.
create policy "organization members may receive analysis progress"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.analyses a
    where ('analysis:' || a.id::text) = realtime.topic()
      and a.organization_id = coalesce(
        auth.jwt() -> 'o' ->> 'id',
        auth.jwt() ->> 'org_id',
        auth.jwt() ->> 'https://www.clerk.com/claims/org_id'
      )
  )
);

create or replace function public.broadcast_analysis_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.stage is distinct from new.stage
    or old.stage_message is distinct from new.stage_message
    or old.status is distinct from new.status then
    perform realtime.send(
      jsonb_build_object('stage', new.stage, 'message', new.stage_message, 'status', new.status),
      'stage_update',
      'analysis:' || new.id::text,
      true
    );
  end if;
  return new;
end;
$$;

create trigger analyses_broadcast_progress
after update of stage, stage_message, status on public.analyses
for each row execute function public.broadcast_analysis_progress();

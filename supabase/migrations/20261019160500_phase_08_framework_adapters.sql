-- Persist the adapter selected for an analysis and the source file that
-- produced each exact route so the map can display framework-specific data.
alter table public.analyses
  add column framework text not null default 'generic';

alter table public.routes
  add column source_file text;

create index routes_analysis_id_idx on public.routes (analysis_id);

create index file_roles_file_id_idx on public.file_roles (file_id);

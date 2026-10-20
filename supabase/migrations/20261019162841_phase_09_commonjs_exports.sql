-- Static export names from CommonJS files are saved with each parsed file.
alter table public.files
  add column commonjs_exports text[] not null default '{}'::text[];

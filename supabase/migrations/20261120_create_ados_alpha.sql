-- Four-user alpha data. No anonymous table or storage policies are granted.
-- Only the Edge Function's server-side secret key can access these resources.
create table public.ados_alpha_testers (
  id text primary key check (id ~ '^tester[1-4]$'),
  pass_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.ados_alpha_files (
  id uuid primary key default gen_random_uuid(),
  project text not null default 'ces27' check (project = 'ces27'),
  name text not null,
  mime text not null,
  storage_path text not null unique,
  content text not null,
  uploaded_by text not null references public.ados_alpha_testers(id),
  created_at timestamptz not null default now()
);
create index ados_alpha_files_project_created on public.ados_alpha_files(project, created_at desc);
create table public.ados_alpha_questions (
  tester_id text not null references public.ados_alpha_testers(id),
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (tester_id, day)
);
alter table public.ados_alpha_testers enable row level security;
alter table public.ados_alpha_files enable row level security;
alter table public.ados_alpha_questions enable row level security;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ados-alpha', 'ados-alpha', false, 1048576,
        array['text/plain','text/markdown','text/csv','application/csv','application/octet-stream'])
on conflict (id) do nothing;

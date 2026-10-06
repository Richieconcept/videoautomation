-- Future PostgreSQL schema for Render deployment.
-- The current local build uses storage/automation/state.json with matching concepts.

create table if not exists creators (
  id text primary key,
  name text not null,
  aliases jsonb not null default '[]',
  priority text not null default 'normal',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_sources (
  id text primary key,
  creator_id text not null references creators(id),
  platform text not null,
  profile_url text not null,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_seen_post_id text,
  last_seen_published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_posts (
  id text primary key,
  creator_id text not null references creators(id),
  source_id text not null references creator_sources(id),
  platform text not null,
  external_post_id text not null,
  post_url text not null,
  title text,
  caption text,
  published_at timestamptz,
  duration numeric,
  thumbnail_url text,
  discovered_at timestamptz not null default now(),
  status text not null,
  content_fingerprint text,
  duplicate_of text,
  job_id text
);

create unique index if not exists source_posts_platform_external_id
  on source_posts(platform, external_post_id);

create table if not exists video_jobs (
  id text primary key,
  source_type text not null,
  creator_id text,
  source_post_id text,
  priority integer not null,
  discovered_at timestamptz,
  source_platform text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publishing_results (
  id text primary key,
  job_id text not null,
  platform text not null,
  status text not null,
  buffer_post_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

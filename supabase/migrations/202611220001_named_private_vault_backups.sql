-- GM Vault 2.2.0: named copies. Apply after 202611210001.
-- A separate table keeps an already-open single-copy client from updating
-- multiple named copies. Preserve its original row as a read-only fallback.
begin;
lock table public.private_vault_backups in access exclusive mode;

create table public.private_vault_backup_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_write_id uuid not null,
  constraint backup_entry_name check (
    name = btrim(name) and char_length(name) between 1 and 80 and
    name !~ '[[:cntrl:]]'
  ),
  constraint backup_entry_name_unique unique (user_id, name),
  constraint backup_entry_shape check (
    jsonb_typeof(payload) = 'object' and
    payload ? 'categories' and jsonb_typeof(payload -> 'categories') = 'array' and
    (not (payload ? 'pages') or jsonb_typeof(payload -> 'pages') = 'array') and
    not (payload ?| array['token','notionToken','session','access_token','refresh_token','email'])
  ),
  constraint backup_entry_size check (octet_length(payload::text) <= 2097152)
);

-- Copy before installing the metadata trigger so revision and date survive.
insert into public.private_vault_backup_entries
  (user_id, name, schema_version, payload, revision, created_at, updated_at, last_write_id)
select user_id, 'Previous backup', schema_version, payload, revision, updated_at, updated_at, last_write_id
from public.private_vault_backups;

alter table public.private_vault_backup_entries enable row level security;
revoke all on public.private_vault_backup_entries from public, anon, authenticated;
grant select on public.private_vault_backup_entries to authenticated;
grant insert (id, user_id, name, schema_version, payload, last_write_id)
  on public.private_vault_backup_entries to authenticated;
grant update (schema_version, payload, last_write_id)
  on public.private_vault_backup_entries to authenticated;

create policy backup_entry_select_own on public.private_vault_backup_entries for select to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy backup_entry_insert_own on public.private_vault_backup_entries for insert to authenticated
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy backup_entry_update_own on public.private_vault_backup_entries for update to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true')
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');

create function public.gm_vault_backup_entry_metadata() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    NEW.revision := 1;
    NEW.created_at := clock_timestamp();
  else
    if NEW.user_id <> OLD.user_id or NEW.id <> OLD.id or NEW.name <> OLD.name then
      raise exception 'backup_identity_immutable';
    end if;
    NEW.revision := OLD.revision + 1;
    NEW.created_at := OLD.created_at;
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end;
$$;
revoke all on function public.gm_vault_backup_entry_metadata() from public, anon, authenticated;
create trigger gm_vault_backup_entry_metadata before insert or update on public.private_vault_backup_entries
  for each row execute function public.gm_vault_backup_entry_metadata();

-- Old tabs can still restore their original copy, but must reload to save.
revoke insert (user_id, schema_version, payload, last_write_id)
  on public.private_vault_backups from authenticated;
revoke update (schema_version, payload, last_write_id)
  on public.private_vault_backups from authenticated;
commit;

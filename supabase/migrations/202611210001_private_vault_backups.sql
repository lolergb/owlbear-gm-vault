-- GM Vault 2.2.0. Apply to a dedicated Supabase project before enabling backups.
begin;

create table public.private_vault_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  last_write_id uuid not null,
  constraint backup_shape check (
    jsonb_typeof(payload) = 'object' and
    payload ? 'categories' and jsonb_typeof(payload -> 'categories') = 'array' and
    (not (payload ? 'pages') or jsonb_typeof(payload -> 'pages') = 'array') and
    not (payload ?| array['token','notionToken','session','access_token','refresh_token','email'])
  ),
  constraint backup_size check (octet_length(payload::text) <= 2097152)
);

alter table public.private_vault_backups enable row level security;
revoke all on public.private_vault_backups from public, anon, authenticated;
grant select on public.private_vault_backups to authenticated;
-- Column grants prevent changing owner/metadata through direct API requests.
grant insert (user_id, schema_version, payload, last_write_id) on public.private_vault_backups to authenticated;
grant update (schema_version, payload, last_write_id) on public.private_vault_backups to authenticated;

create policy backup_select_own on public.private_vault_backups for select to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy backup_insert_own on public.private_vault_backups for insert to authenticated
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy backup_update_own on public.private_vault_backups for update to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true')
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');

create function public.gm_vault_backup_metadata() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    NEW.revision := 1;
  else
    if NEW.user_id <> OLD.user_id then raise exception 'backup_owner_immutable'; end if;
    NEW.revision := OLD.revision + 1;
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end;
$$;
revoke all on function public.gm_vault_backup_metadata() from public, anon, authenticated;
create trigger gm_vault_backup_metadata before insert or update on public.private_vault_backups
  for each row execute function public.gm_vault_backup_metadata();

commit;

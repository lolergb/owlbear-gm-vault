begin;

-- Keep direct table deletes disabled. Each request targets one reviewed version.
create function public.delete_private_vault_backup(p_id uuid, p_revision bigint, p_name text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise insufficient_privilege;
  end if;

  delete from public.private_vault_backup_entries
    where user_id = owner_id and id = p_id and revision = p_revision and name = p_name;
  if not found then return false; end if;

  -- The named-backup migration gave every legacy row this immutable name.
  -- Old clients must not be able to recover a copy its owner just deleted.
  if p_name = 'Previous backup' then
    delete from public.private_vault_backups where user_id = owner_id;
  end if;
  return true;
end;
$$;

revoke all on function public.delete_private_vault_backup(uuid, bigint, text) from public, anon;
grant execute on function public.delete_private_vault_backup(uuid, bigint, text) to authenticated;
commit;

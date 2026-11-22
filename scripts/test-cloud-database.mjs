// Executes the shipping migration against real PostgreSQL (PGlite), with
// Supabase's JWT helpers represented by the same request claim settings.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const write = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const payload = { categories: [], pages: [{ id: 'page-1', name: 'Test', url: 'https://example.test' }] };
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
async function denied(sql, params = [], code = '42501') {
  await assert.rejects(db.query(sql, params), error => error.code === code);
  checks++;
}
async function as(role, user, extra = {}) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, ...extra })]);
  await db.exec(`set role ${role}`);
}
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users values ('${a}'), ('${b}'), ('${c}');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202611210001_private_vault_backups.sql', import.meta.url), 'utf8'));
  await as('anon', null);
  await denied('select * from public.private_vault_backups');
  await denied('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3)', [a, payload, write]);
  await as('authenticated', a);
  let result = await db.query('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3) returning *', [a, payload, write]);
  check(result.rows[0].revision === 1, 'first revision is server assigned');
  check(result.rows[0].updated_at instanceof Date, 'server timestamp');
  await denied('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3)', [a, payload, write], '23505');
  await denied('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3)', [b, payload, write]);
  await as('authenticated', b);
  check((await db.query('select * from public.private_vault_backups')).rows.length === 0, 'B cannot list A');
  result = await db.query('update public.private_vault_backups set payload=$1 where user_id=$2 returning *', [payload, a]);
  check(result.rows.length === 0, 'B cannot update A');
  await db.query('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3)', [b, payload, write]);
  check((await db.query('select user_id from public.private_vault_backups')).rows[0].user_id === b, 'B reads own row only');
  await as('authenticated', a);
  result = await db.query('update public.private_vault_backups set payload=$1,last_write_id=$2 where user_id=$3 and revision=1 returning revision', [payload, write, a]);
  check(result.rows[0].revision === 2, 'update increments revision');
  result = await db.query('update public.private_vault_backups set payload=$1 where user_id=$2 and revision=1 returning *', [payload, a]);
  check(result.rows.length === 0, 'stale update loses CAS race');
  await denied('update public.private_vault_backups set user_id=$1 where user_id=$2', [c, a]);
  await denied('update public.private_vault_backups set revision=20 where user_id=$1', [a]);
  await denied("update public.private_vault_backups set updated_at='2000-01-01' where user_id=$1", [a]);
  await denied('delete from public.private_vault_backups where user_id=$1', [a]);
  await denied('truncate public.private_vault_backups');
  await denied('update public.private_vault_backups set payload=$1 where user_id=$2', [{ categories: 'invalid' }, a], '23514');
  await denied('update public.private_vault_backups set payload=$1 where user_id=$2', [{ categories: [], token: 'not-uploadable' }, a], '23514');
  await denied('update public.private_vault_backups set payload=$1 where user_id=$2', [{ categories: [], pages: [{ name: 'x'.repeat(2097152) }] }, a], '23514');
  await denied('update public.private_vault_backups set schema_version=2 where user_id=$1', [a], '23514');
  await as('authenticated', c, { is_anonymous: true });
  await denied('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3)', [c, payload, write]);
  check((await db.query('select * from public.private_vault_backups')).rows.length === 0, 'anonymous Auth account cannot list backups');
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [a]);
  check((await db.query('select * from public.private_vault_backups where user_id=$1', [a])).rows.length === 0, 'deleting account removes its backup');
  check((await db.query('select * from public.private_vault_backups where user_id=$1', [b])).rows.length === 1, 'account deletion leaves other account intact');
  // Upgrade an already-used database and retain its original copy exactly.
  await as('authenticated', b);
  const legacy = (await db.query('update public.private_vault_backups set payload=$1 where user_id=$2 returning *', [payload, b])).rows[0];
  await db.exec('reset role');
  await db.query('insert into auth.users values ($1)', [a]);
  await db.exec(await readFile(new URL('../supabase/migrations/202611220001_named_private_vault_backups.sql', import.meta.url), 'utf8'));
  await as('authenticated', b);
  const migrated = (await db.query('select * from public.private_vault_backup_entries')).rows[0];
  check(migrated.name === 'Previous backup' && migrated.revision === legacy.revision, 'migration preserves previous copy and revision');
  assert.deepEqual(migrated.payload, legacy.payload); checks++;
  check(+migrated.updated_at === +legacy.updated_at, 'migration preserves original timestamp');
  await denied('update public.private_vault_backups set payload=$1 where user_id=$2', [payload, b]);
  await denied('insert into public.private_vault_backups (user_id,payload,last_write_id) values ($1,$2,$3)', [b, payload, write]);
  check((await db.query('select revision from public.private_vault_backups')).rows[0].revision === legacy.revision, 'legacy copy remains readable and unchanged');
  const alpha = (await db.query('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4) returning *', [b, 'Campaign A', payload, write])).rows[0];
  const beta = (await db.query('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4) returning *', [b, 'Campaign B', payload, write])).rows[0];
  check(alpha.id !== beta.id && alpha.revision === 1, 'separate names have independent identities and first revision');
  check((await db.query('select id from public.private_vault_backup_entries')).rows.length === 3, 'one account keeps several named copies');
  await denied('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4)', [b, 'Campaign A', payload, write], '23505');
  for (const name of ['', ' spaced ', 'x'.repeat(81), 'line\nbreak']) {
    await denied('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4)', [b, name, payload, write], '23514');
  }
  await as('authenticated', c);
  check((await db.query('select id from public.private_vault_backup_entries')).rows.length === 0, 'other account cannot list any named copies');
  await denied('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4)', [b, 'Injected', payload, write]);
  const own = (await db.query('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4) returning *', [c, 'Campaign A', payload, write])).rows[0];
  check(own.user_id === c, 'different accounts may use the same name');
  check((await db.query('update public.private_vault_backup_entries set payload=$1 where id=$2 returning id', [payload, alpha.id])).rows.length === 0, 'other account cannot replace a chosen copy');
  await as('authenticated', b);
  const replaced = (await db.query('update public.private_vault_backup_entries set payload=$1,last_write_id=$2 where user_id=$3 and id=$4 and revision=1 returning *', [payload, write, b, alpha.id])).rows[0];
  check(replaced.revision === 2 && +replaced.created_at === +alpha.created_at, 'named replacement increments revision and preserves creation date');
  check((await db.query('select revision from public.private_vault_backup_entries where id=$1', [beta.id])).rows[0].revision === 1, 'replacement leaves another named copy untouched');
  check((await db.query('update public.private_vault_backup_entries set payload=$1 where id=$2 and revision=1 returning id', [payload, alpha.id])).rows.length === 0, 'stale named replacement cannot overwrite a newer revision');
  for (const column of ['id', 'user_id', 'name', 'revision', 'created_at', 'updated_at']) {
    await denied(`update public.private_vault_backup_entries set ${column}=${column} where id=$1`, [alpha.id]);
  }
  await denied('delete from public.private_vault_backup_entries where id=$1', [alpha.id]);
  await denied('truncate public.private_vault_backup_entries');
  await denied('update public.private_vault_backup_entries set payload=$1 where id=$2', [{ categories: [], token: 'not-uploadable' }, alpha.id], '23514');
  await denied('update public.private_vault_backup_entries set payload=$1 where id=$2', [{ categories: [], pages: [{ name: 'x'.repeat(2097152) }] }, alpha.id], '23514');
  await as('authenticated', a, { is_anonymous: true });
  check((await db.query('select id from public.private_vault_backup_entries')).rows.length === 0, 'anonymous Auth account cannot list named copies');
  await denied('insert into public.private_vault_backup_entries (user_id,name,payload,last_write_id) values ($1,$2,$3,$4)', [a, 'Anonymous', payload, write]);
  await as('anon', null);
  await denied('select * from public.private_vault_backup_entries');
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [b]);
  check((await db.query('select id from public.private_vault_backup_entries where user_id=$1', [b])).rows.length === 0, 'account deletion removes all its named copies');
  check((await db.query('select id from public.private_vault_backup_entries where user_id=$1', [c])).rows.length === 1, 'other account keeps its named copy');
  console.log(`PASS: ${checks} PostgreSQL backup isolation, permission, limit and conflict checks`);
} finally { await db.close(); }

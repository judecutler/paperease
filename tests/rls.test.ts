// Runs the real SQL migrations in an in-process Postgres (PGlite) and checks the row level security policies.
// Skipped when @electric-sql/pglite is not installed (npm i -D @electric-sql/pglite to enable).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';

const MIG = path.join(process.cwd(), 'supabase', 'migrations');
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const ADMIN_A = '11111111-1111-1111-1111-111111111111';
const VIEWER_A = '22222222-2222-2222-2222-222222222222';
const ADMIN_B = '33333333-3333-3333-3333-333333333333';

let pg: any;
let skip: string | false = false;

before(async () => {
  try {
    const { PGlite } = await import('@electric-sql/pglite' as string);
    pg = new PGlite();
  } catch { skip = 'pglite not installed'; return; }
  // the bits of Supabase the migrations lean on
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const f of ['20261017000000_init.sql', '20261017000001_caregiver_position.sql', '20261017000002_insert_order.sql', '20261017000004_sweep_rules.sql', '20261017000005_registry_check.sql', '202610170001_regulatory.sql', '20261018000001_core_auth_rls.sql', '20261018000002_app_docs.sql', '20261018000003_languages.sql']) {
    try { await pg.exec(fs.readFileSync(path.join(MIG, f), 'utf8')); } catch (e) { throw new Error(`${f}: ${(e as Error).message}`); }
  }
  await pg.exec(`
    insert into auth.users values ('${ADMIN_A}'), ('${VIEWER_A}'), ('${ADMIN_B}');
    insert into agencies(id,name,admin,expiring_within_days,min_confidence,max_follow_ups) values ('${A}','A','a',30,0.6,2), ('${B}','B','b',30,0.6,2);
    insert into requirement_types(id,agency_id,name,rule,sms_collectible,ask,fields) values ('r1','${A}','R','r',true,'a','[]');
    insert into caregivers(id,agency_id,name,first_name,phone,hired_on) values ('ca','${A}','Ann','Ann','1','2026-01-01'), ('cb','${B}','Bob','Bob','2','2026-01-01');
    insert into audit_events(id,caregiver_id,actor,action,agency_id) values ('e1','ca','agent','x','${A}'), ('e2','cb','agent','y','${B}');
    insert into reg_memberships(user_id,agency_id,role) values ('${ADMIN_A}','${A}','admin'), ('${VIEWER_A}','${A}','viewer'), ('${ADMIN_B}','${B}','admin');
  `);
});

// run statements as a signed-in user (or anon) with RLS applied
async function as(user: string | null, sql: string) {
  await pg.exec(`set role ${user ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`);
  try { return await pg.query(sql); } finally { await pg.exec('reset role'); }
}

describe('core table row level security', () => {
  it('migrations apply in order', (t) => { if (skip) return t.skip(skip); assert.ok(pg); });
  it('a member sees only their own agency\'s rows', async (t) => {
    if (skip) return t.skip(skip);
    assert.deepEqual((await as(ADMIN_A, 'select id from caregivers')).rows, [{ id: 'ca' }]);
    assert.deepEqual((await as(ADMIN_B, 'select id from caregivers')).rows, [{ id: 'cb' }]);
    assert.deepEqual((await as(ADMIN_A, 'select id from audit_events')).rows, [{ id: 'e1' }]);
    assert.deepEqual((await as(VIEWER_A, 'select id from caregivers')).rows, [{ id: 'ca' }]);
  });
  it('anonymous callers see nothing', async (t) => {
    if (skip) return t.skip(skip);
    assert.equal((await as(null, 'select id from caregivers')).rows.length, 0);
    assert.equal((await as(null, 'select id from audit_events')).rows.length, 0);
  });
  it('a viewer cannot write; an admin cannot write into another agency', async (t) => {
    if (skip) return t.skip(skip);
    await assert.rejects(as(VIEWER_A, `insert into caregivers(id,agency_id,name,first_name,phone,hired_on) values ('x','${A}','X','X','3','2026-01-01')`));
    await assert.rejects(as(ADMIN_A, `insert into caregivers(id,agency_id,name,first_name,phone,hired_on) values ('y','${B}','Y','Y','3','2026-01-01')`));
    await as(ADMIN_A, `insert into caregivers(id,agency_id,name,first_name,phone,hired_on) values ('z','${A}','Z','Z','3','2026-01-01')`);
    assert.equal((await as(ADMIN_A, `update caregivers set name='Q' where id='cb'`)).affectedRows, 0);
  });
  it('audit history can be added to but not edited', async (t) => {
    if (skip) return t.skip(skip);
    await as(ADMIN_A, `insert into audit_events(id,caregiver_id,actor,action,agency_id) values ('e3','ca','admin','z','${A}')`);
    await assert.rejects(as(ADMIN_A, `insert into audit_events(id,caregiver_id,actor,action,agency_id) values ('e4','cb','admin','z','${B}')`));
    assert.equal((await as(ADMIN_A, `delete from audit_events where id='e1'`)).affectedRows, 0, 'no delete policy');
    // even the server role cannot rewrite a row; an identical re-send (the app upserts) stays harmless
    await assert.rejects(pg.exec(`update audit_events set action='changed' where id='e1'`), /append-only/);
    await pg.exec(`update audit_events set action='x' where id='e1'`);
  });
  it('app_docs and the regulatory tables stay closed to signed-in users', async (t) => {
    if (skip) return t.skip(skip);
    await pg.exec(`insert into app_docs(key,data) values ('wallet','{}')`);
    assert.equal((await as(ADMIN_A, 'select * from app_docs')).rows.length, 0, 'RLS on with no policy: zero rows');
    await assert.rejects(as(ADMIN_A, `insert into app_docs(key,data) values ('x','{}')`));
    await assert.rejects(as(ADMIN_A, 'select * from reg_memberships'));
  });
  it('language check accepts the new codes and rejects others', async (t) => {
    if (skip) return t.skip(skip);
    await pg.exec(`insert into caregivers(id,agency_id,name,first_name,phone,hired_on,language) values ('t1','${A}','T','T','4','2026-01-01','tl')`);
    await assert.rejects(pg.exec(`insert into caregivers(id,agency_id,name,first_name,phone,hired_on,language) values ('t2','${A}','T','T','4','2026-01-01','fr')`));
  });
});

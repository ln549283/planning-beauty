import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import EmbeddedPostgres from 'embedded-postgres'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-test-'))
const port = Number(process.env.PLANNING_TEST_PORT || 55548)
const password = crypto.randomUUID()
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  port,
  user: 'postgres',
  password,
  persistent: false,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: () => {},
})
const clients = []
async function connect() {
  const c = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password,
    database: 'postgres',
  })
  await c.connect()
  clients.push(c)
  return c
}
await pg.initialise()
await pg.start()
try {
  const root = await connect()
  await root.query(`create schema auth; create role anon; create role authenticated; create role service_role; create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('app.email',true)) $$;
grant usage on schema auth to authenticated,anon; grant usage on schema public to anon,authenticated;`)
  const migrations = fileURLToPath(
    new URL('../supabase/migrations/', import.meta.url),
  )
  for (const file of fs.readdirSync(migrations).sort())
    await root.query(fs.readFileSync(migrations + '/' + file, 'utf8'))
  async function user(name) {
    const c = await connect()
    const id = crypto.randomUUID(),
      email = name + '@example.test'
    await root.query('insert into auth.users values($1,$2)', [id, email])
    await c.query('set role authenticated')
    await c.query(
      "select set_config('app.uid',$1,false),set_config('app.email',$2,false)",
      [id, email],
    )
    return { c, id, email }
  }
  async function fn(c, name, ...args) {
    const result = await c.query(
      'select public.' +
        name +
        '(' +
        args.map((_, i) => '$' + (i + 1)).join(',') +
        ') as x',
      args,
    )
    return result.rows[0]?.x
  }
  const u = await user('owner'),
    m = await user('manager'),
    e = await user('employee'),
    other = await user('other')
  const i = await fn(
      u.c,
      'creer_institut',
      'Test institut',
      'Premium',
      'Julie',
    ),
    j = await fn(other.c, 'creer_institut', 'Autre', 'Solo', 'Autre')
  const member = async (dest, role) =>
    fn(dest.c, 'rejoindre', await fn(u.c, 'inviter', i, dest.email, role), role)
  await member(m, 'responsable')
  await member(e, 'employee')
  await assert.rejects(
    fn(other.c, 'inviter', j, 'test@example.test', 'employee'),
  )
  await fn(
    u.c,
    'enregistrer_soin',
    i,
    null,
    'Formule',
    40,
    6000,
    [],
    [],
    'Kit',
    true,
    true,
  )
  const sid = (await u.c.query('select id from public.soins')).rows[0].id
  const hrs = Object.fromEntries(
    Array.from({ length: 7 }, (_, k) => [
      k + 1,
      ['09:00', '12:00', '13:00', '18:00'],
    ]),
  )
  await fn(u.c, 'regler_institut', i, 'Test institut', '#125441', 5, hrs, true)
  const anon = await connect()
  await anon.query('set role anon')
  const date = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
  const book = (c, web = true) =>
    fn(
      c,
      'reserver',
      i,
      u.id,
      sid,
      date + 'T10:00',
      'Test',
      'test@example.test',
      web,
    )
  await assert.rejects(book(anon, false))
  const concurrent = await Promise.allSettled([book(anon), book(m.c)])
  if (!concurrent.some((v) => v.status === 'fulfilled')) console.log(concurrent)
  assert.equal(concurrent.filter((v) => v.status === 'fulfilled').length, 1)
  let r = (await u.c.query('select * from public.rendez_vous')).rows[0]
  assert.equal(
    (await e.c.query('select * from public.rendez_vous')).rowCount,
    0,
  )
  assert.equal((await e.c.query('select * from public.clientes')).rowCount, 0)
  assert.equal(
    (await other.c.query('select * from public.rendez_vous')).rowCount,
    0,
  )
  await assert.rejects(fn(e.c, 'deplacer', r.id, date + 'T13:00'))
  await assert.rejects(
    fn(
      u.c,
      'bloquer',
      i,
      [],
      'Réunion',
      date + 'T10:00',
      date + 'T11:00',
      false,
    ),
  )
  const b = await fn(
    m.c,
    'bloquer',
    i,
    [],
    'Réunion',
    date + 'T10:00',
    date + 'T11:00',
    true,
  )
  await fn(m.c, 'deplacer', r.id, date + 'T13:00')
  await fn(u.c, 'debloquer', b)
  const idem = crypto.randomUUID()
  const card = await fn(u.c, 'vendre_carte', i, 6000, idem)
  assert.equal(await fn(u.c, 'vendre_carte', i, 6000, idem), card)
  const op = crypto.randomUUID()
  for (let retry = 0; retry < 2; retry++)
    await fn(u.c, 'encaisser', r.id, 'carte utilisée', 4500, card, op)
  await fn(u.c, 'encaisser', r.id, 'encaissement', 1500, '')
  await fn(m.c, 'statut_rdv', r.id, 'annulé')
  await fn(m.c, 'statut_rdv', r.id, 'annulé')
  assert.equal(
    (await u.c.query('select solde from public.cartes')).rows[0].solde,
    6000,
  )
  assert.equal(
    (
      await u.c.query(
        "select centimes from public.mouvements where type='crédit accordé'",
      )
    ).rows[0].centimes,
    1500,
  )
  assert.equal((await other.c.query('select * from public.cartes')).rowCount, 0)
  assert.equal((await m.c.query('select * from public.mouvements')).rowCount, 0)
  const t = await book(anon)
  assert.equal((await fn(anon, 'mon_rdv', t, true)).statut, 'annulé')
  await assert.rejects(
    fn(
      anon,
      'reserver',
      i,
      u.id,
      sid,
      date + 'T11:20',
      'Limite',
      'test@example.test',
      true,
    ),
  )

  const feed = await fn(u.c, 'mon_calendrier', i, false)
  await assert.rejects(fn(anon, 'lire_flux', feed))
  await fn(u.c, 'mon_calendrier', i, true)
  await fn(m.c, 'exception_jour', i, null, date, '[]')
  assert.equal(
    (
      await anon.query('select * from public.creneaux($1,$2,$3)', [
        i,
        sid,
        date,
      ])
    ).rowCount,
    0,
  )
  await fn(m.c, 'exception_jour', i, null, date, null)
  await fn(m.c, 'liste_attente', i, null, 'A', 'contact', sid, date)
  assert.equal((await e.c.query('select * from public.attente')).rowCount, 0)
  await fn(u.c, 'gerer_collegue', i, e.id, 'employee', false, {})
  assert.equal((await e.c.query('select * from public.instituts')).rowCount, 0)
  const jobs = await root.query('select * from public.prendre_courriers()')
  assert(jobs.rows.some((j) => j.type === 'Annulation'))
  assert.equal(
    (await root.query('select * from public.prendre_courriers()')).rowCount,
    0,
  )
  await assert.rejects(fn(anon, 'prendre_courriers'))
  console.log(
    'OK · migrations, offres, rôles, isolation, concurrence, marge, blocages, exceptions, crédits, bons, révocation, rappels et liste d’attente.',
  )
} finally {
  await Promise.allSettled(clients.map((c) => c.end()))
  await pg.stop()
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
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
  await root.query(`create schema auth; create role anon; create role authenticated; create role service_role; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),encrypted_password text);
create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now());
create table auth.identities(user_id uuid,provider text,identity_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('app.email',true),'session_id',current_setting('app.session',true),'amr',jsonb_build_array(jsonb_build_object('method',current_setting('app.method',true)))) $$;
grant usage on schema auth to authenticated,anon; grant usage on schema public to anon,authenticated;`)
  const migrations = fileURLToPath(
    new URL('../supabase/migrations/', import.meta.url),
  )
  // Upgrade a site where the first release was installed manually in SQL Editor.
  const first = fs.readdirSync(migrations).sort()[0]
  await root.query(fs.readFileSync(path.join(migrations, first), 'utf8'))
  const install = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../scripts/deployer.mjs', import.meta.url)),
      '--sql',
    ],
    { encoding: 'utf8' },
  )
  await root.query(install)
  await root.query(install)
  async function user(name, method = 'email/signup') {
    const c = await connect()
    const id = crypto.randomUUID(),
      email = name + '@example.test'
    await root.query('insert into auth.users(id,email) values($1,$2)', [
      id,
      email,
    ])
    const sessionId = crypto.randomUUID()
    await root.query('insert into auth.sessions(id,user_id) values($1,$2)', [
      sessionId,
      id,
    ])
    await c.query('set role authenticated')
    await c.query(
      "select set_config('app.uid',$1,false),set_config('app.email',$2,false),set_config('app.session',$3,false),set_config('app.method',$4,false)",
      [id, email, sessionId, method],
    )
    if (method === 'email/signup')
      assert.equal(await fn(c, 'acces_professionnel'), 'accordé')
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
  const ancien = await user('ancien', 'password')
  assert.equal(await fn(ancien.c, 'acces_professionnel'), 'vérification')
  await assert.rejects(
    fn(ancien.c, 'creer_institut', 'Interdit', 'Solo', 'Test'),
    /Vérifiez/,
  )
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
  const hrsTot = await fn(u.c, 'occupation', i, date, date, u.id)
  assert.equal(hrsTot.ouvrables, 480)
  assert.equal(hrsTot.occupees, 0)
  await assert.rejects(fn(other.c, 'occupation', i, date, date, null))
  await fn(
    u.c,
    'enregistrer_soin',
    i,
    null,
    'Épilation',
    10,
    1200,
    [],
    [],
    'Cire',
    true,
    true,
  )
  const second = (
    await u.c.query("select id from public.soins where nom='Épilation'")
  ).rows[0].id
  const ids = [sid, second],
    operation = crypto.randomUUID()
  const multi = (amount, op) =>
    fn(
      anon,
      'reserver_selection',
      i,
      u.id,
      ids,
      date + 'T09:00',
      'Duo',
      'duo@example.test',
      amount,
      50,
      op,
    )
  await assert.rejects(multi(6000, operation), /tarifs/)
  const multiToken = await multi(7200, operation)
  assert.equal(await multi(7200, operation), multiToken)
  const multiVisit = await fn(anon, 'mon_rdv', multiToken)
  assert.equal(multiVisit.minutes, 50)
  assert.equal(multiVisit.centimes, 7200)
  assert.equal((await fn(u.c, 'occupation', i, date, date, u.id)).occupees, 60)
  await fn(anon, 'mon_rdv', multiToken, true)
  await fn(
    u.c,
    'enregistrer_soin',
    i,
    null,
    'Forfait duo',
    null,
    null,
    ids,
    [],
    '',
    true,
    true,
  )
  const formule = (
    await u.c.query("select * from public.soins where nom='Forfait duo'")
  ).rows[0]
  assert.equal(formule.minutes, 50)
  assert.equal(formule.centimes, 7200)
  const ftoken = await fn(
    anon,
    'reserver_selection',
    i,
    u.id,
    [formule.id],
    date + 'T09:00',
    'Duo',
    'duo@example.test',
    7200,
    50,
    crypto.randomUUID(),
  )
  assert.equal((await fn(u.c, 'occupation', i, date, date, u.id)).occupees, 55)
  await fn(anon, 'mon_rdv', ftoken, true)
  const normal = await book(anon)
  const overrideArgs = [
    i,
    u.id,
    sid,
    date + 'T10:20',
    'Cliente accueil',
    'accueil@example.test',
    'Présence de la gérante confirmée',
  ]
  await assert.rejects(
    fn(m.c, 'reserver_exception', ...overrideArgs),
    /gérante/,
  )
  const overlap = await fn(u.c, 'reserver_exception', ...overrideArgs)
  assert.equal((await fn(u.c, 'occupation', i, date, date, u.id)).occupees, 65)
  await fn(anon, 'mon_rdv', normal, true)
  await assert.rejects(book(anon), /indisponible/)
  await fn(u.c, 'statut_rdv', overlap, 'annulé')
  const service = await connect()
  await service.query('set role service_role')
  await assert.rejects(fn(u.c, 'synchroniser_marchand', i, 'acct_test', true))
  await fn(service, 'synchroniser_marchand', i, 'acct_test', true)
  await fn(u.c, 'regler_paiement', i, 'pourcentage', 25, true)
  const reservation = await book(anon)
  const held = await fn(anon, 'mon_rdv', reservation)
  assert.equal(held.statut, 'en paiement')
  assert.equal(held.avance, 1500)
  await assert.rejects(book(anon), /indisponible/)
  const order = await fn(service, 'checkout_prive', reservation, false)
  await assert.rejects(fn(anon, 'checkout_prive', reservation, false))
  const rid = (
    await root.query('select rdv from beauty_private.commandes where id=$1', [
      order.id,
    ])
  ).rows[0].rdv
  assert.equal(
    (
      await root.query('select * from beauty_private.courriers where rdv=$1', [
        rid,
      ])
    ).rowCount,
    0,
  )
  await assert.rejects(
    fn(
      service,
      'finaliser_checkout',
      order.id,
      'acct_autre',
      'pi_recette',
      1500,
      'eur',
    ),
  )
  await assert.rejects(
    fn(
      service,
      'finaliser_checkout',
      order.id,
      'acct_test',
      'pi_recette',
      null,
      'eur',
    ),
  )
  for (let count = 0; count < 2; count++)
    assert.equal(
      await fn(
        service,
        'finaliser_checkout',
        order.id,
        'acct_test',
        'pi_recette',
        1500,
        'eur',
      ),
      'traité',
    )
  assert.equal((await fn(anon, 'mon_rdv', reservation)).statut, 'confirmé')
  assert.equal(
    (
      await root.query(
        "select count(*)::int n from public.mouvements where rdv=$1 and type='encaissement'",
        [rid],
      )
    ).rows[0].n,
    1,
  )
  assert.equal(
    (
      await root.query(
        "select count(*)::int n from beauty_private.courriers where rdv=$1 and type='Confirmation'",
        [rid],
      )
    ).rows[0].n,
    1,
  )
  assert.equal(
    await fn(
      service,
      'finaliser_checkout',
      order.id,
      'acct_test',
      'pi_duplicate',
      1500,
      'eur',
    ),
    'rembourser',
  )
  await assert.rejects(fn(u.c, 'statut_rdv', rid, 'absent'), /commencé/)
  await fn(anon, 'mon_rdv', reservation, true)
  const late = await book(anon),
    lateOrder = await fn(service, 'checkout_prive', late, false)
  await root.query(
    "update public.rendez_vous set echeance=now()-interval '1 minute' where id=(select rdv from beauty_private.commandes where id=$1)",
    [lateOrder.id],
  )
  const replacement = await book(anon)
  assert.equal((await fn(anon, 'mon_rdv', late)).statut, 'expiré')
  assert.equal(
    await fn(
      service,
      'finaliser_checkout',
      lateOrder.id,
      'acct_test',
      'pi_late',
      1500,
      'eur',
    ),
    'rembourser',
  )
  await fn(anon, 'mon_rdv', replacement, true)
  const gift = await fn(anon, 'acheter_bon', i, 4500)
  assert.equal((await fn(anon, 'etat_achat', gift)).code, null)
  await fn(
    service,
    'finaliser_checkout',
    gift,
    'acct_test',
    'pi_bon',
    4500,
    'eur',
  )
  const issued = await fn(anon, 'etat_achat', gift)
  assert.equal(issued.solde, 4500)
  assert.notEqual(issued.code, card)
  assert.equal(await fn(anon, 'etat_achat', reservation), null)
  await fn(u.c, 'regler_fidelite', i, 50, 'Soin offert')
  const counter = await fn(
    u.c,
    'reserver',
    i,
    u.id,
    sid,
    date + 'T14:00',
    'Test',
    'test@example.test',
    false,
  )
  const customer = (
    await u.c.query('select cliente_id from public.rendez_vous where id=$1', [
      counter,
    ])
  ).rows[0].cliente_id
  await fn(
    u.c,
    'modifier_fiche',
    customer,
    '0692000000',
    'Sans parfum',
    'Préparer le kit',
  )
  await assert.rejects(fn(other.c, 'modifier_fiche', customer, '', '', ''))
  await fn(u.c, 'cocher_materiel', i, date, 'Kit', true)
  assert.equal(await fn(u.c, 'materiel_prepare', i, date), 'Kit')
  assert.equal(await fn(m.c, 'materiel_prepare', i, date), undefined)
  await fn(u.c, 'encaisser', counter, 'carte utilisée', 4500, issued.code)
  await fn(u.c, 'encaisser', counter, 'encaissement', 1500, '')
  assert.equal((await fn(u.c, 'ma_fidelite', customer)).points, 0)
  await root.query(
    "update public.rendez_vous set debut=debut-interval '10 days',fin=fin-interval '10 days' where id=$1",
    [counter],
  )
  await fn(u.c, 'statut_rdv', counter, 'réalisé')
  assert.equal((await fn(u.c, 'ma_fidelite', customer)).points, 60)
  const reward = crypto.randomUUID()
  for (let n = 0; n < 2; n++) await fn(u.c, 'remettre_cadeau', customer, reward)
  assert.equal((await fn(u.c, 'ma_fidelite', customer)).points, 10)
  await assert.rejects(
    fn(u.c, 'remettre_cadeau', customer, crypto.randomUUID()),
    /indisponible/,
  )
  // Private account information is independent of membership and public booking.
  const profileArgs = [
    'Julie',
    'Lagon',
    'Non précisé',
    null,
    '',
    '',
    '',
    '',
    '',
  ]
  await fn(u.c, 'enregistrer_profil', ...profileArgs)
  assert.equal((await fn(u.c, 'mon_profil')).nom, 'Lagon')
  assert.equal(await fn(other.c, 'mon_profil'), null)
  await assert.rejects(fn(anon, 'mon_profil'))
  await assert.rejects(fn(ancien.c, 'enregistrer_profil', ...profileArgs))
  await assert.rejects(
    fn(
      u.c,
      'enregistrer_profil',
      'Julie',
      'Lagon',
      'Femme',
      '2150-01-01',
      '',
      '',
      '',
      '',
      '',
    ),
    /futur/,
  )
  const batchId = crypto.randomUUID()
  const newRows = [
    { nom: 'Import A', minutes: 15, centimes: 1050 },
    { nom: 'Import B', minutes: 20, centimes: 1600 },
  ]
  const submit = (conn, op, list) =>
    fn(conn, 'importer_soins', i, op, JSON.stringify(list), false)
  await assert.rejects(submit(other.c, batchId, newRows))
  await assert.rejects(
    submit(u.c, batchId, [newRows[0], { ...newRows[1], minutes: 0 }]),
    /Ligne 2/,
  )
  assert.equal(
    (await u.c.query("select id from public.soins where nom='Import A'"))
      .rowCount,
    0,
  )
  assert.equal(await submit(u.c, batchId, newRows), 2)
  assert.equal(await submit(u.c, batchId, newRows), 2)
  await assert.rejects(submit(u.c, crypto.randomUUID(), newRows), /existe déjà/)
  assert.equal(
    (await u.c.query("select en_ligne from public.soins where nom='Import A'"))
      .rows[0].en_ligne,
    false,
  )
  const brows = crypto.randomUUID(),
    lips = crypto.randomUUID(),
    bundle = crypto.randomUUID()
  const configure = (
    id,
    name,
    sub,
    duration,
    price,
    parts = [],
    suggestions = [],
    replace = [],
    online = true,
  ) =>
    fn(
      u.c,
      'configurer_soin',
      i,
      id,
      name,
      duration,
      price,
      parts,
      [],
      '',
      online,
      true,
      'Épilations',
      sub,
      '',
      suggestions,
      replace,
    )
  await configure(lips, 'Lèvres', 'Fil', 10, 800)
  await configure(brows, 'Sourcils', 'Fil', 15, 1000)
  await configure(bundle, 'Duo', 'Fil', 15, 1800, [brows, lips])
  await configure(
    brows,
    'Sourcils',
    'Fil',
    15,
    1000,
    [],
    [bundle, lips],
    [bundle],
  )
  const catalogue = () => fn(anon, 'catalogue_public', i)
  const item = (await catalogue()).soins.find((x) => x.id === brows)
  assert.deepEqual(item.suggestions, [bundle, lips])
  assert.deepEqual(item.remplacements, [bundle])
  assert.equal(item.sous_categorie, 'Fil')
  await configure(lips, 'Lèvres', 'Fil', 10, 800, [], [], [], false)
  assert.deepEqual(
    (await catalogue()).soins.find((x) => x.id === brows).suggestions,
    [bundle],
  )
  const rows = await u.c.query(
    "select * from couleurs_categories where institut_id=$1 and categorie='Épilations'",
    [i],
  )
  assert.equal(rows.rowCount, 2)
  assert.equal(new Set(rows.rows.map((c) => c.couleur)).size, 2)
  await fn(u.c, 'colorer_categorie', i, rows.rows[0].id, '#115533')
  await assert.rejects(
    fn(other.c, 'colorer_categorie', i, rows.rows[0].id, '#ffffff'),
  )
  await assert.rejects(
    configure(brows, 'Sourcils', 'Fil', 15, 1000, [], [sid], [sid]),
  )
  const day = new Date(Date.now() + 18 * 864e5).toISOString().slice(0, 10)
  const args = [i, u.id, [bundle], day]
  assert(
    (
      await u.c.query(
        'select * from public.creneaux_comptoir($1,$2,$3,$4,1)',
        args,
      )
    ).rowCount > 1,
  )
  assert.equal(
    (
      await u.c.query(
        'select * from public.creneaux_comptoir($1,$2,$3,$4,5)',
        args,
      )
    ).rowCount,
    5,
  )
  await assert.rejects(fn(e.c, 'creneaux_comptoir', ...args, 1))
  await assert.rejects(fn(anon, 'creneaux_comptoir', ...args, 1))
  const clientId = (
    await root.query(
      "insert into public.clientes(institut_id,nom) values($1,'Camille Payet') returning id",
      [i],
    )
  ).rows[0].id
  const atDesk = (c) =>
    fn(
      c,
      'reserver_comptoir',
      i,
      u.id,
      [bundle],
      day + 'T09:30',
      clientId,
      '',
      '',
    )
  const visit = await atDesk(m.c)
  await assert.rejects(atDesk(m.c))
  const booked = (
    await root.query('select * from rendez_vous where id=$1', [visit])
  ).rows[0]
  assert.equal(booked.cliente_id, clientId)
  assert.equal(booked.statut, 'confirmé')
  assert.equal(booked.origine, 'institut')
  assert.equal(booked.avance, 0)
  assert.equal(booked.minutes + booked.marge, 20)
  assert.equal(booked.centimes, 1800)
  assert.equal(
    (
      await u.c.query(
        'select from public.creneaux_comptoir($1,$2,$3,$4,1) where debut=$5',
        [...args, day + 'T09:30'],
      )
    ).rowCount,
    0,
  )
  console.log(
    'OK · suggestions ordonnées, formule de remplacement, couleurs, disponibilités et reprise sans acompte.',
  )
  await assert.rejects(fn(m.c, 'transferer_gerance', i, u.id))
  await assert.rejects(fn(u.c, 'transferer_gerance', i, other.id))
  await fn(u.c, 'transferer_gerance', i, m.id)
  assert.equal(
    (
      await m.c.query(
        "select personne from public.equipe where institut_id=$1 and role='gerante'",
        [i],
      )
    ).rows[0].personne,
    m.id,
  )
  await assert.rejects(submit(u.c, crypto.randomUUID(), newRows))
  assert.equal(await fn(m.c, 'mon_profil'), null)
  console.log(
    'OK · profil privé, lot atomique et rejouable, gérance transférée et anciens droits retirés.',
  )
  console.log(
    'OK · avances, expiration, paiement répété, bon en ligne, encaissement fractionné, vérification du rôle, fidélité et préparation.',
  )
  console.log(
    'OK · migrations, offres, rôles, isolation, concurrence, marge, blocages, exceptions, crédits, bons, révocation, rappels et liste d’attente.',
  )
} finally {
  await Promise.allSettled(clients.map((c) => c.end()))
  await pg.stop()
}

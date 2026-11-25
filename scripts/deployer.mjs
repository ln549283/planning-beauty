import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const directory = new URL('../supabase/migrations/', import.meta.url)
const versions = readdirSync(directory)
  .filter((n) => /^\d+_[a-z_]+\.sql$/.test(n))
  .sort()
function migrationSQL() {
  const statements = [
    `begin;
 select pg_advisory_xact_lock(hashtextextended('planning-beauty-migrations',0));
 create schema if not exists beauty_private;
 revoke all on schema beauty_private from public;
 create table if not exists beauty_private.livraisons(version text primary key, empreinte text not null);
 revoke all on beauty_private.livraisons from public,anon,authenticated;`,
  ]
  for (const file of versions) {
    const source = readFileSync(new URL(file, directory), 'utf8'),
      hash = createHash('sha256').update(source).digest('hex')
    const body = source
      .trim()
      .replace(/^begin;/i, '')
      .replace(/commit;$/i, '')
    // The first release was also distributed as a single transactional SQL file.
    const legacy =
      file === versions[0]
        ? `if to_regclass('public.instituts') is not null then
   if not exists(select 1 from pg_constraint where conrelid='public.rendez_vous'::regclass and conname='rdv_sans_chevauchement')
   or not exists(select 1 from pg_policies where schemaname='public' and tablename='rendez_vous' and policyname='agenda')
   or to_regprocedure('public.gerer_collegue(uuid,uuid,text,boolean,jsonb)') is null
   or exists(select 1 from unnest(array['instituts','equipe','soins','clientes','rendez_vous','blocages','cartes','mouvements','exceptions_horaires','attente']) t where not exists(select 1 from pg_class c where c.oid=to_regclass('public.'||t) and c.relrowsecurity))
   then raise exception 'Schéma préexistant incomplet, installation interrompue'; end if;
   else execute $migration$${body}$migration$; end if;`
        : `execute $migration$${body}$migration$;`
    statements.push(`do $release$ begin
   if exists(select 1 from beauty_private.livraisons where version='${file}') then
     if not exists(select 1 from beauty_private.livraisons where version='${file}' and empreinte='${hash}') then raise exception 'Migration déjà appliquée avec un contenu différent'; end if;
   else
     ${legacy}
     insert into beauty_private.livraisons values ('${file}','${hash}');
   end if;
   end $release$;`)
  }
  return statements
    .concat("notify pgrst,'reload schema';", 'commit;')
    .join('\n')
}
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.env.SUPABASE_PROJECT_REF || 'eeuvauqtqhtxnrzvggzt'
const site =
  new URL(process.env.APP_URL || 'https://planning-beauty-a3zp.onrender.com/')
    .origin + '/'
async function api(method, path, body) {
  if (!token || !/^[a-z0-9_-]+$/i.test(token) || !/^\w+$/.test(ref))
    throw Error(
      'Renseignez SUPABASE_ACCESS_TOKEN dans les secrets de déploiement.',
    )
  const args = [
    '--silent',
    '--show-error',
    '--fail',
    '--max-time',
    '150',
    '--config',
    '-',
    '--request',
    method,
    'https://api.supabase.com/v1/projects/' + ref + path,
  ]
  const config = [
    'header = "Authorization: Bearer ' + token + '"',
    'header = "Content-Type: application/json"',
  ]
  if (body) config.push('data-binary = ' + JSON.stringify(JSON.stringify(body)))
  const result = spawnSync('curl', args, {
    input: config.join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0)
    throw Error(
      'Échec de la requête ' +
        method +
        ' ' +
        path +
        ' · ' +
        (result.stderr || result.error?.message || ''),
    )
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}
if (process.argv.includes('--sql')) console.log(migrationSQL())
else if (process.argv.includes('--rappels')) {
  const secret = process.env.RAPPELS_SECRET
  const sender = process.env.BREVO_SENDER_EMAIL,
    brevo = process.env.BREVO_API_KEY
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(secret || '') || !sender || !brevo)
    throw Error(
      'Le rappel automatique nécessite RAPPELS_SECRET, BREVO_SENDER_EMAIL et BREVO_API_KEY.',
    )
  await api(
    'POST',
    '/secrets',
    Object.entries({
      RAPPELS_SECRET: secret,
      BREVO_SENDER_EMAIL: sender,
      BREVO_API_KEY: brevo,
      APP_URL: site,
    }).map(([name, value]) => ({ name, value })),
  )
  const query = `begin;
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   create extension if not exists supabase_vault;
   do $$ declare v uuid; begin
   select id into v from vault.secrets where name='planning_rappels';
   if v is null then perform vault.create_secret('${secret}','planning_rappels');
   else perform vault.update_secret(v,'${secret}'); end if;
   end $$;
   select cron.schedule('planning-beaute-rappels','* * * * *',$cron$
     select net.http_post(url:='https://${ref}.supabase.co/functions/v1/rappels',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='planning_rappels')),body:='{}'::jsonb);
   $cron$);
   commit;`
  await api('POST', '/database/query', { query })
  const jobs = await api('POST', '/database/query', {
    query:
      "select active from cron.job where jobname='planning-beaute-rappels'",
  })
  if (!jobs[0]?.active) throw Error('Programmation des rappels non vérifiée')
  console.log('Tâche de rappel active, chaque minute.')
} else {
  const current = await api('GET', '/config/auth')
  const redirects = [
    ...new Set([
      ...(current.uri_allow_list || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      site,
      site + '?invitation=*',
    ]),
  ]
  const changes = {
    site_url: site,
    uri_allow_list: redirects.join(','),
    mailer_autoconfirm: false,
    external_email_enabled: true,
    password_min_length: Math.max(8, current.password_min_length || 0),
    password_required_characters:
      'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~',
    mailer_secure_email_change_enabled: true,
    security_update_password_require_reauthentication: true,
  }
  await api('PATCH', '/config/auth', changes)
  const receipt = await api('GET', '/config/auth')
  for (const [key, value] of Object.entries(changes))
    if (receipt[key] !== value)
      throw Error('Configuration non vérifiée · ' + key)
  await api('POST', '/database/query', { query: migrationSQL() })
  const checks = await api('POST', '/database/query', {
    query: 'select version from beauty_private.livraisons order by version;',
  })
  if (
    !Array.isArray(checks) ||
    !versions.every((n) => checks.some((x) => x.version === n))
  )
    throw Error('Historique de livraison incomplet')
  console.log(
    'Configuration Auth relue et vérifiée. ' +
      versions.length +
      ' migrations vérifiées.',
  )
}

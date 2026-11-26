import { createHash } from 'node:crypto'
import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'

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
// Honor the runner's HTTPS proxy when supported by Node.
http.setGlobalProxyFromEnv?.()
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const ref = process.env.SUPABASE_PROJECT_REF || 'eeuvauqtqhtxnrzvggzt'
const site =
  new URL(process.env.APP_URL || 'https://planning-beauty-a3zp.onrender.com/')
    .origin + '/'

async function api(method, path, body) {
  if (!token)
    throw Error(
      'Secret SUPABASE_ACCESS_TOKEN absent. Ajoutez-le dans GitHub Actions, environnement production.',
    )
  if (/^(sb_secret_|sb_publishable_|github_pat_|gh[pousr]_)/.test(token))
    throw Error(
      'SUPABASE_ACCESS_TOKEN doit contenir un Personal Access Token créé dans le compte Supabase.',
    )
  if (!/^[a-z0-9]+$/.test(ref))
    throw Error('Référence de projet Supabase invalide.')
  const url = 'https://api.supabase.com/v1/projects/' + ref + path
  const result = await fetch(url, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(150000),
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!result.ok) {
    const prefix = method + ' ' + path + ' · HTTP ' + result.status
    if (result.status === 401)
      throw Error(
        prefix + ' · Vérifiez que le jeton personnel Supabase est valide.',
      )
    if (result.status === 403)
      throw Error(
        prefix +
          ' · Vérifiez les droits du compte Supabase sur le projet ' +
          ref +
          '.',
      )
    if (result.status === 404)
      throw Error(prefix + ' · Vérifiez la référence du projet et son accès.')
    // Auth responses and reminders can contain private settings. Only report known
    // field names or PostgreSQL diagnostics for the non-secret schema migration.
    const failure = await result.json().catch(() => null)
    const message = typeof failure?.message === 'string' ? failure.message : ''
    if (path === '/database/query' && !process.argv.includes('--rappels')) {
      const sql = message.match(
        /\b[0-9A-Z]{5}: [^\r\n]{1,300}/,
      )
      if (sql) throw Error(prefix + ' · ' + sql[0].split('CONTEXT:')[0])
    }
    const fields = Object.keys(body || {}).filter(
      (key) => path === '/config/auth' && JSON.stringify(failure).includes(key),
    )
    throw Error(
      prefix +
        (fields.length
          ? ' · Réglage refusé : ' + fields.join(', ')
          : ' · Requête refusée par Supabase.'),
    )
  }
  const data = await result.text()
  return data.trim() ? JSON.parse(data) : null
}
function matchesSetting(key, expected, actual) {
  if (key === 'uri_allow_list') {
    const urls = (value) =>
      [
        ...new Set(
          String(value || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ]
        .sort()
        .join(',')
    return urls(expected) === urls(actual)
  }
  if (key === 'site_url') {
    try {
      return new URL(expected).href === new URL(actual).href
    } catch {
      return false
    }
  }
  return actual === expected
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
  console.log('Vérification de la configuration Auth du projet ' + ref)
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
  const modified = Object.fromEntries(
    Object.entries(changes).filter(
      ([key, value]) => !matchesSetting(key, value, current[key]),
    ),
  )
  if (Object.keys(modified).length) await api('PATCH', '/config/auth', modified)
  const receipt = await api('GET', '/config/auth')
  for (const [key, value] of Object.entries(changes))
    if (!matchesSetting(key, value, receipt[key]))
      throw Error('Configuration non vérifiée · ' + key)
  console.log(
    'Configuration Auth vérifiée. Installation du schéma en transaction.',
  )
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

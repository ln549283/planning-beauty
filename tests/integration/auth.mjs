import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { Client } from 'pg'

const base = 'http://127.0.0.1:59999',
  mailbox = 'http://127.0.0.1:58025'
const redirect = 'http://127.0.0.1:58000/'
const email = 'julie-' + randomBytes(8).toString('hex') + '@example.test'
const password = 'Test!2' + randomBytes(12).toString('hex')
const pg = new Client({
  host: '127.0.0.1',
  port: 55442,
  user: 'postgres',
  password: process.env.TEST_DB_PASSWORD,
  database: 'postgres',
})
async function call(path, body, token) {
  const res = await fetch(base + path, {
    method: path === '/user' ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}
function pkce() {
  const verifier = randomBytes(36).toString('base64url')
  return {
    verifier,
    params: {
      code_challenge_method: 's256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    },
  }
}
async function readLink(subject) {
  for (let n = 0; n < 40; n++) {
    const { messages } = await (
      await fetch(mailbox + '/api/v1/messages')
    ).json()
    const m = messages.find(
      (x) =>
        x.To.some((to) => to.Address === email) &&
        x.Subject.toLowerCase().includes(subject),
    )
    if (m) {
      const content = await (
        await fetch(mailbox + '/api/v1/message/' + m.ID)
      ).json()
      const match = content.HTML.match(/href="([^"]+\/verify\?[^"]+)"/)
      assert(match, 'Lien de vérification dans le vrai message SMTP')
      return match[1].replaceAll('&amp;', '&')
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw Error('Aucun message SMTP reçu')
}
async function exchange(subject, challenge) {
  const link = await readLink(subject)
  const r = await fetch(link, { redirect: 'manual' })
  const destination = new URL(r.headers.get('location'))
  assert.equal(destination.origin, new URL(redirect).origin)
  const code = destination.searchParams.get('code')
  assert(code, 'Code PKCE fourni après le clic')
  const result = await call('/token?grant_type=pkce', {
    auth_code: code,
    code_verifier: challenge.verifier,
  })
  assert.equal(result.status, 200, 'Échange du code')
  return result.data.access_token
}
async function query(token, sql, params = []) {
  // The local test uses the exact claims of the token validated by GoTrue.
  const remote = await fetch(base + '/user', {
    headers: { Authorization: 'Bearer ' + token },
  })
  assert.equal(remote.status, 200)
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))
  await pg.query('begin')
  try {
    await pg.query('set local role authenticated')
    await pg.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(claims),
    ])
    const result = await pg.query(sql, params)
    await pg.query('commit')
    return result.rows[0]?.result
  } catch (error) {
    await pg.query('rollback')
    throw error
  }
}
const access = (t) => query(t, 'select public.acces_professionnel() result')
await pg.connect()
try {
  const release = execFileSync(
    process.execPath,
    ['scripts/deployer.mjs', '--sql'],
    { encoding: 'utf8' },
  )
  await pg.query(release)
  await pg.query(release)
  await pg.query('grant usage on schema auth to authenticated,anon')
  const challenge = pkce()
  const weak = await call('/signup', {
    email,
    password: 'weakpass',
    ...challenge.params,
  })
  assert.equal(
    weak.status,
    422,
    'La politique de mot de passe doit être imposée par le serveur',
  )
  const signup = await call(
    '/signup?redirect_to=' + encodeURIComponent(redirect),
    { email, password, ...challenge.params },
  )
  assert.equal(signup.status, 200, 'Inscription')
  const login = () => call('/token?grant_type=password', { email, password })
  if (process.env.TEST_AUTOCONFIRM === 'true') {
    // Regression fixture for accounts from the former configuration.
    assert(signup.data.access_token)
    const old = signup.data.access_token
    assert.equal(await access(old), 'vérification')
    await assert.rejects(
      query(
        old,
        "select public.creer_institut('Régression','Solo','Julie') result",
      ),
      /Vérifiez/,
    )
    const recovery = pkce()
    assert.equal(
      (
        await call('/recover?redirect_to=' + encodeURIComponent(redirect), {
          email,
          ...recovery.params,
        })
      ).status,
      200,
    )
    const verified = await exchange('password', recovery)
    assert.equal(await access(verified), 'nouveau mot de passe')
    assert.equal(
      (await call('/user', { password: password + 'A!' }, verified)).status,
      200,
    )
    assert.equal(await access(verified), 'accordé')
    assert.equal((await login()).status, 400)
    assert.equal(
      await access(
        (
          await call('/token?grant_type=password', {
            email,
            password: password + 'A!',
          })
        ).data.access_token,
      ),
      'accordé',
    )
    console.log(
      'OK · ancien compte auto-confirmé bloqué, e-mail de récupération, nouveau mot de passe et nouvelle connexion.',
    )
  } else if (process.env.TEST_RESEND === 'true') {
    assert(!signup.data.access_token)
    const recovery = pkce()
    await new Promise((r) => setTimeout(r, 1100))
    assert.equal(
      (
        await call('/recover?redirect_to=' + encodeURIComponent(redirect), {
          email,
          ...recovery.params,
        })
      ).status,
      200,
    )
    const token = await exchange('password', recovery)
    assert.equal(await access(token), 'nouveau mot de passe')
    assert.equal(
      (await call('/user', { password: password + 'A!' }, token)).status,
      200,
    )
    assert.equal(await access(token), 'accordé')
    console.log(
      'OK · lien remplacé, adresse en attente vérifiée et nouveau mot de passe accepté.',
    )
  } else {
    assert(!signup.data.access_token)
    assert.equal((await login()).data.error_code, 'email_not_confirmed')
    const confirmed = await exchange('confirm', challenge)
    assert.equal(await access(confirmed), 'accordé')
    const fresh = await login()
    assert.equal(await access(fresh.data.access_token), 'accordé')
    assert(
      await query(
        fresh.data.access_token,
        "select public.creer_institut('Recette','Premium','Julie') result",
      ),
    )
    console.log(
      'OK · aucun accès avant confirmation, réception SMTP, clic de confirmation, connexion par mot de passe et création de l’institut.',
    )
  }
} finally {
  await pg.end()
}

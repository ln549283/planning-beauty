import { chromium } from 'playwright-core'
import { createHmac, randomBytes } from 'node:crypto'
import { createServer, request } from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'

const origin = 'http://127.0.0.1:58000'
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')
const signature =
  encode({ alg: 'HS256', typ: 'JWT' }) +
  '.' +
  encode({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })
const key =
  signature +
  '.' +
  createHmac('sha256', process.env.TEST_JWT_SECRET)
    .update(signature)
    .digest('base64url')
const vite = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    '58001',
    '--strictPort',
  ],
  {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: origin,
      VITE_SUPABASE_PUBLISHABLE_KEY: key,
    },
    stdio: 'ignore',
  },
)
const gateway = createServer((req, res) => {
  const prefix = ['/auth/v1', '/rest/v1'].find((p) => req.url.startsWith(p))
  const proxy = request(
    {
      hostname: '127.0.0.1',
      port: prefix === '/auth/v1' ? 59999 : prefix ? 53000 : 58001,
      path: prefix ? req.url.slice(prefix.length) : req.url,
      method: req.method,
      headers: req.headers,
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    },
  )
  proxy.on('error', () => {
    res.writeHead(503)
    res.end()
  })
  req.pipe(proxy)
})
let browser
try {
  await new Promise((resolve) => gateway.listen(58000, '127.0.0.1', resolve))
  for (let i = 0; i < 60; i++) {
    if ((await fetch(origin)).ok && (await fetch(origin + '/rest/v1/')).ok)
      break
    await new Promise((r) => setTimeout(r, 250))
  }
  await promisify(execFile)(
    process.execPath,
    ['scripts/verifier-backend.mjs', '--check'],
    {
      env: {
        ...process.env,
        VITE_SUPABASE_URL: origin,
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      },
    },
  )
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage(),
    faults = []
  page.on('pageerror', (e) => faults.push(e.message))
  const email =
      'navigateur-' + randomBytes(6).toString('hex') + '@example.test',
    password = 'Test!42x' + randomBytes(8).toString('hex')
  await page.goto(origin)
  await page.getByRole('button', { name: 'Inscription', exact: true }).click()
  await page.getByLabel('Votre prénom').fill('Julie')
  await page.getByLabel('Votre nom', { exact: true }).fill('Recette')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.locator('#password').fill(password)
  await page.getByLabel('Confirmer le mot de passe').fill(password + 'x')
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await page.getByRole('alert').filter({ hasText: 'identiques' }).waitFor()
  await page.getByLabel('Confirmer le mot de passe').fill(password)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await page.getByText('Ouvrez le lien de confirmation').waitFor()
  const mailbox = 'http://127.0.0.1:58025/api/v1'
  const { messages } = await (await fetch(mailbox + '/messages')).json()
  const mail = messages.find((m) => m.To.some((to) => to.Address === email))
  assert(mail)
  const msg = await (await fetch(mailbox + '/message/' + mail.ID)).json()
  await page.goto(
    msg.HTML.match(/href="([^"]+\/verify\?[^"]+)"/)[1].replaceAll('&amp;', '&'),
  )
  await page.getByLabel('Nom de l’institut').fill('Institut navigateur')
  await page.getByRole('button', { name: 'Créer mon institut' }).click()
  await page.getByRole('heading', { name: 'Agenda', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Semaine', exact: true }).click()
  await page.getByRole('button', { name: 'Jour', exact: true }).click()
  await page.getByRole('button', { name: 'Prestations', exact: true }).click()
  await page.getByRole('button', { name: 'Prestation', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nom', { exact: true }).fill('Soin recette')
  await dialog.getByRole('spinbutton').nth(0).fill('30')
  await dialog.getByRole('spinbutton').nth(1).fill('45')
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await page.getByRole('heading', { name: 'Soin recette' }).waitFor()
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click()
  await page.getByRole('heading', { name: 'Programme de fidélité' }).waitFor()
  await page.getByLabel('Lundi', { exact: true }).check()
  await page.getByLabel('Ouvrir les réservations en ligne').check()
  await page
    .locator('form')
    .filter({ has: page.getByLabel('Ouvrir les réservations en ligne') })
    .getByRole('button', { name: 'Enregistrer', exact: true })
    .click()
  const bookingUrl = await page
    .getByRole('link', { name: 'Ouvrir la page de réservation' })
    .getAttribute('href')
  const guest = await browser.newPage()
  await guest.goto(bookingUrl)
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7))
  await guest
    .getByLabel('Date à La Réunion')
    .fill(day.toISOString().slice(0, 10))
  const slot = guest.getByLabel('Choisir un créneau')
  await slot
    .selectOption({ index: 1 }, { timeout: 8000 })
    .catch(async (err) => {
      throw Error(
        (await guest.locator('body').innerText()) +
          ' · ' +
          day.toISOString() +
          ' · ' +
          err.message,
      )
    })
  await guest.getByLabel('Prénom et nom').fill('Cliente recette')
  await guest.getByLabel('E-mail', { exact: true }).fill('cliente@example.test')
  await guest.getByRole('button', { name: 'Confirmer ma réservation' }).click()
  await guest.getByText('confirmé', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Clientes', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Clientes', exact: true }).click()
  await page.getByRole('button', { name: /Cliente recette/ }).click()
  await page.getByText('Coordonnées, préférences et notes').click()
  await page.getByLabel('Préférences de soin').fill('Sans parfum')
  await page.getByRole('button', { name: 'Enregistrer la fiche' }).click()
  await page.getByText('Fiche enregistrée.').waitFor()
  guest.once('dialog', (d) => d.accept())
  await guest.getByRole('button', { name: 'Annuler mon rendez-vous' }).click()
  await guest.getByText('annulé', { exact: true }).waitFor()
  await guest.close()
  await page.getByRole('button', { name: 'Déconnexion' }).click()
  await page.getByRole('button', { name: 'Se connecter' }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.getByRole('heading', { name: 'Agenda', exact: true }).waitFor()
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  )
  assert.deepEqual(faults, [])
  console.log(
    'OK · Chromium, Supabase Auth, SMTP et PostgREST · double saisie, inscription, confirmation, institut vierge, agenda jour/semaine, réservation publique, fiche cliente, annulation et reconnexion mobile.',
  )
} finally {
  await browser?.close()
  gateway.closeAllConnections()
  gateway.close()
  vite.kill()
}

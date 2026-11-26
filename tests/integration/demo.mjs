import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const port = 58009,
  origin = 'http://127.0.0.1:' + port
const vite = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: 'ignore' },
)
let browser
try {
  for (let n = 0; n < 80; n++) {
    if (
      await fetch(origin)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  const external = [],
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route(/^https?:/, async (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue()
    external.push(new URL(route.request().url()).origin)
    return route.abort()
  })
  await page.goto(origin + '/?demo=1')
  const heading = (name) => page.getByRole('heading', { name, exact: true })
  const button = (name) => page.getByRole('button', { name, exact: true })
  await heading('Agenda')
    .waitFor({ timeout: 30000 })
    .catch(async (err) => {
      throw Error(
        errors + ' ' + (await page.locator('main').innerText()) + ' ' + err,
      )
    })
  await button('Prestations').click()
  assert.equal(await page.locator('article.tile').count(), 20)
  await heading('Épilations au fil').waitFor()
  await heading('Épilations à la cire classique').waitFor()
  assert.equal(
    await heading('Épilations au fil')
      .locator('..')
      .locator('article.tile')
      .count(),
    5,
  )
  assert.equal(
    await heading('Épilations à la cire classique')
      .locator('..')
      .locator('article.tile')
      .count(),
    15,
  )
  const bundle = heading(
    'Aisselles + Demi-jambes + Maillot intégral · Cire classique',
  ).locator('..')
  assert.match(await bundle.innerText(), /45 min · 55,00/)
  assert.equal(
    await page
      .locator('article.tile small')
      .filter({ hasText: 'Formule' })
      .count(),
    5,
  )
  await bundle.getByRole('button', { name: 'Modifier' }).click()
  await page.getByText(/50 min, préparation incluse/).waitFor()
  await button('Fermer').click()
  await button('Ajouter plusieurs prestations').click()
  const first = page.getByRole('textbox', {
    name: 'Nom · ligne 1',
    exact: true,
  })
  await first.evaluate((input) => {
    const data = new DataTransfer()
    data.setData(
      'text/plain',
      'Soin test A\t25 min\t12,50 €\nSoin test B\t15\t8,20',
    )
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await button('Créer 2 prestations').click()
  await heading('Soin test A').waitFor()
  assert.equal(await page.locator('article.tile').count(), 22)
  await button('Mon profil').click()
  await page.getByLabel('Ville', { exact: true }).fill('Saint-Paul')
  await button('Enregistrer').click()
  await page.getByText('Profil enregistré.').waitFor()
  await button('Équipe').click()
  await page.getByText('Gérant(e)', { exact: true }).waitFor()
  await button('Mon profil').click()
  assert.equal(
    await page.getByLabel('Ville', { exact: true }).inputValue(),
    'Saint-Paul',
  )
  await button('Préparer ma journée').click()
  await heading('4 rendez-vous').waitFor()
  await button('Paramètres').click()
  await page
    .getByText(
      'Vos clientes peuvent réserver entre 1 heure et 180 jours à l’avance.',
    )
    .waitFor()
  await page.getByLabel('Délai minimum avant le rendez-vous (min)').fill('30')
  await page
    .getByText(
      'Vos clientes peuvent réserver entre 30 min et 180 jours à l’avance.',
    )
    .waitFor()
  assert.equal(
    await page
      .getByLabel('À qui s’applique ce changement ?')
      .locator('option')
      .count(),
    4,
  )
  page.once('dialog', (d) => d.accept())
  await button('Réinitialiser la démo').click()
  await heading('Agenda').waitFor()
  await button('Prestations').click()
  assert.equal(await page.locator('article.tile').count(), 20)
  await page.setViewportSize({ width: 390, height: 844 })
  await button('Ajouter plusieurs prestations').click()
  await page
    .getByRole('textbox', { name: 'Nom · ligne 1', exact: true })
    .fill('Essai mobile')
  await page
    .getByRole('textbox', { name: 'Durée (min) · ligne 1', exact: true })
    .fill('15')
  await page
    .getByRole('textbox', { name: 'Prix (€) · ligne 1', exact: true })
    .fill('10')
  await page
    .getByRole('textbox', { name: 'Prix (€) · ligne 1', exact: true })
    .press('Enter')
  await page
    .getByRole('textbox', { name: 'Nom · ligne 2', exact: true })
    .waitFor()
  assert(
    await page.evaluate(
      () =>
        document.querySelector('dialog').scrollWidth <=
        document.querySelector('dialog').clientWidth + 1,
    ),
  )
  await button('Créer 1 prestation').click()
  await heading('Essai mobile').waitFor()
  assert.deepEqual(external, [])
  assert.deepEqual(errors, [])
  console.log(
    'OK · démo de production isolée, 20 soins, deux catégories, import tableur, profil, réglages, préparation et réinitialisation.',
  )
} finally {
  await browser?.close()
  vite.kill()
}

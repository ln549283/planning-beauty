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
  await heading('Épilations › Fil').waitFor()
  await heading('Épilations › Cire classique').waitFor()
  assert.equal(
    await heading('Épilations › Fil')
      .locator('..')
      .locator('article.tile')
      .count(),
    5,
  )
  assert.equal(
    await heading('Épilations › Cire classique')
      .locator('..')
      .locator('article.tile')
      .count(),
    15,
  )
  const bundle = heading('Aisselles + Demi-jambes + Maillot intégral').locator(
    '..',
  )
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
  await button('Agenda').click()
  await button('Année').click()
  await page.locator('.year-grid button').first().click()
  await page.locator('.month-grid button').first().click()
  await page.getByRole('button', { name: 'Aujourd’hui' }).click()
  await page.locator('.event.visit').first().click()
  await button('Reprendre rendez-vous').click()
  assert(await page.getByLabel('Nom et prénom de la cliente').inputValue())
  const nextMonth = new Date()
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1)
  await page
    .getByLabel('Mois et année')
    .fill(nextMonth.toISOString().slice(0, 7))
  await page
    .getByLabel('Horaires disponibles')
    .locator('option')
    .nth(1)
    .waitFor({ state: 'attached', timeout: 10000 })
    .catch(async (e) => {
      throw Error(
        (await page.locator('dialog').innerText()) + ' ' + errors + ' ' + e,
      )
    })
  await page.getByLabel('Horaires disponibles').selectOption({ index: 1 })
  await button('Réserver').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('link', { name: 'Page de réservation cliente' }).click()
  await heading('Réserver un soin').waitFor()
  const service = page.getByLabel('Prestation', { exact: true })
  const brow = service
    .locator('option')
    .filter({ hasText: /^Sourcils — Épilations › Fil/ })
  await service.selectOption(
    await brow.getAttribute('value', { timeout: 5000 }).catch(async (e) => {
      throw Error(
        (await page.locator('main').innerText()) + ' ' + errors + ' ' + e,
      )
    }),
  )
  await page.getByLabel(/Passer à la formule/).check()
  await page.getByText(/15 min de soins · 18,00/).waitFor()
  await page.getByRole('link', { name: 'Agenda de démonstration' }).click()
  await button('Clientes').click()
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.locator('.client-list .listrow').first().click()
  const listBounds = await page.locator('.client-list').boundingBox()
  const detailBounds = await page.locator('.client-detail').boundingBox()
  assert(listBounds.x + listBounds.width <= detailBounds.x + 1)
  await button('Prendre rendez-vous').click()
  assert(await page.getByLabel('Nom et prénom de la cliente').inputValue())
  await button('Fermer').click()
  await page.setViewportSize({ width: 1280, height: 850 })
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
  await page.getByLabel('Mercredi · horaire 2').fill('11:45')
  await page
    .locator('.hours-row')
    .filter({ has: page.getByText('Jeudi', { exact: true }) })
    .getByRole('button', { name: /Copier mercredi/ })
    .click()
  assert.equal(await page.getByLabel('Jeudi · horaire 2').inputValue(), '11:45')
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
    'OK · démo de production isolée, catalogue, import, agenda mensuel et annuel, reprise au comptoir, formule suggérée, fiche tablette, horaires et réinitialisation.',
  )
} finally {
  await browser?.close()
  vite.kill()
}

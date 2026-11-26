import { loadEnv } from 'vite'
const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env }
if (env.RENDER === 'true' || process.argv.includes('--check')) {
  const base =
    env.VITE_SUPABASE_URL || 'https://eeuvauqtqhtxnrzvggzt.supabase.co'
  const key =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    'sb_publishable_8XnvCnxQmFAO7a6CSwEIDg_YQBcoJsq'
  const headers = { apikey: key, 'content-type': 'application/json' }
  async function check(path, options = {}) {
    const result = await fetch(new URL(path, base), {
      headers,
      ...options,
      signal: AbortSignal.timeout(15000),
    })
    if (!result.ok)
      throw Error(
        'Supabase a refusé la vérification de ' +
          path +
          ' (HTTP ' +
          result.status +
          '). Installez le backend de production avant de publier le site.',
      )
    return result.json()
  }
  const settings = await check('/auth/v1/settings')
  if (settings.mailer_autoconfirm !== false)
    throw Error(
      'Activez la confirmation obligatoire des adresses dans Supabase avant la publication.',
    )
  const installed = await check('/rest/v1/rpc/version_planning', {
    method: 'POST',
    body: '{}',
  })
  if (typeof installed !== 'string' || installed < '202611260001')
    throw Error('Installez les migrations du backend avant de publier le site.')
  console.log(
    'Supabase répond, la confirmation est obligatoire et le schéma de réservation est disponible.',
  )
}

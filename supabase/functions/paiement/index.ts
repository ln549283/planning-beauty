import { createClient } from 'npm:@supabase/supabase-js@2'
import { backend, isId, stripeClient } from '../_shared/stripe.ts'

Deno.serve(async (request) => {
  const app = Deno.env.get('APP_URL')
  if (!app)
    return Response.json({ error: 'Paiements indisponibles' }, { status: 503 })
  const origin = new URL(app).origin
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers })
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'POST')
    return reply({ error: 'Méthode invalide' }, 405)
  try {
    const { action, id } = await request.json()
    if (!isId(id)) return reply({ error: 'Référence invalide' }, 400)
    const api = backend(),
      stripe = stripeClient()
    if (action === 'rendez-vous' || action === 'bon') {
      const { data: order, error } = await api.rpc('checkout_prive', {
        t: id,
        bon: action === 'bon',
      })
      if (error || !order)
        return reply(
          { error: 'Cette commande est expirée ou déjà réglée.' },
          409,
        )
      const target = new URL(app)
      target.searchParams.set(action === 'bon' ? 'bon' : 'rdv', id)
      if (order.session_stripe) {
        const existing = await stripe.checkout.sessions.retrieve(
          order.session_stripe,
          { stripeAccount: order.compte },
        )
        if (existing.status !== 'open' || !existing.url)
          return reply(
            {
              error:
                'Paiement terminé ou expiré. Actualisez votre réservation.',
            },
            409,
          )
        return reply({ url: existing.url })
      }
      const expiry = Math.floor(Date.parse(order.limite) / 1000)
      if (expiry < Date.now() / 1000 + 1810)
        return reply(
          {
            error:
              'Le délai pour commencer un paiement est écoulé. Libérez le créneau et recommencez la réservation, ou commandez un nouveau bon.',
          },
          409,
        )
      const session = await stripe.checkout.sessions.create(
        {
          expires_at: expiry,
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'eur',
                unit_amount: order.montant,
                product_data: { name: order.libelle },
              },
            },
          ],
          metadata: { planning_commande: order.id },
          success_url: target.href,
          cancel_url: target.href,
        },
        { stripeAccount: order.compte, idempotencyKey: 'checkout-' + order.id },
      )
      const saved = await api.rpc('associer_checkout', {
        o: order.id,
        session_id: session.id,
      })
      if (saved.error) throw saved.error
      return reply({ url: session.url })
    }
    if (action !== 'connecter' && action !== 'actualiser')
      return reply({ error: 'Action inconnue' }, 400)
    const member = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: {
            Authorization: request.headers.get('Authorization') || '',
          },
        },
        auth: { persistSession: false },
      },
    )
    const { data: merchant, error } = await member.rpc('mon_marchand', {
      i: id,
    })
    if (error) return reply({ error: 'Accès réservé à la gérante.' }, 403)
    if (!merchant.compte && action === 'actualiser')
      return reply({ actif: false })
    const account = merchant.compte
      ? await stripe.accounts.retrieve(merchant.compte)
      : await stripe.accounts.create(
          { type: 'standard', metadata: { institut: id } },
          { idempotencyKey: 'creation-institut-' + id },
        )
    const active = account.charges_enabled && account.payouts_enabled
    const sync = await api.rpc('synchroniser_marchand', {
      i: id,
      c: account.id,
      a: active,
    })
    if (sync.error) throw sync.error
    if (action === 'actualiser' || active) return reply({ actif: active })
    const target = new URL(app)
    target.searchParams.set('marchand', id)
    const onboarding = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      refresh_url: target.href,
      return_url: target.href,
    })
    return reply({ url: onboarding.url })
  } catch {
    return reply(
      {
        error:
          'Le service de paiement est indisponible. Réessayez ultérieurement.',
      },
      503,
    )
  }
})

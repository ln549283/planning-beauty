import Stripe from 'npm:stripe@18.5.0'
import { handleStripeEvent } from '../../supabase/functions/stripe-evenements/index.ts'
const secret = 'whsec_local_recette'
const order = '00000000-0000-4000-8000-000000000001'
const body = JSON.stringify({
  id: 'evt_recette',
  account: 'acct_recette',
  type: 'checkout.session.completed',
  data: {
    object: {
      metadata: { planning_commande: order },
      payment_status: 'paid',
      payment_intent: 'pi_recette',
      amount_total: 1500,
      currency: 'eur',
    },
  },
})
Deno.test(
  'Webhook Connect signé et demande de remboursement tardif',
  async () => {
    Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_recette')
    Deno.env.set('STRIPE_WEBHOOK_SECRET', secret)
    Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321')
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
    const stripe = new Stripe('sk_test_recette')
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
      cryptoProvider: Stripe.createSubtleCryptoProvider(),
    })
    const original = globalThis.fetch
    let recorded = 0,
      refunds = 0
    try {
      globalThis.fetch = async (input, options) => {
        const request = new Request(input, options)
        if (request.url.endsWith('/rpc/finaliser_checkout')) {
          const data = await request.json()
          if (
            data.o !== order ||
            data.total !== 1500 ||
            data.c !== 'acct_recette'
          )
            throw Error('Commande inattendue')
          recorded++
          return Response.json('rembourser')
        }
        if (
          request.url === 'https://api.stripe.com/v1/refunds' &&
          request.headers.get('Idempotency-Key') ===
            'planning-rembourse-pi_recette' &&
          request.headers.get('Stripe-Account') === 'acct_recette'
        ) {
          refunds++
          return Response.json({ id: 're_recette', object: 'refund' })
        }
        throw Error('Appel imprévu')
      }
      const event = (sig: string) =>
        handleStripeEvent(
          new Request('http://localhost/', {
            method: 'POST',
            body,
            headers: { 'stripe-signature': sig },
          }),
        )
      if ((await event('invalide')).status !== 400 || recorded !== 0)
        throw Error('Signature invalide acceptée')
      if (
        (await event(signature)).status !== 204 ||
        Number(recorded) !== 1 ||
        Number(refunds) !== 1
      )
        throw Error('Remboursement non transmis')
    } finally {
      globalThis.fetch = original
    }
  },
)

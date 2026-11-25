import Stripe from 'npm:stripe@18.5.0'
import { backend, isId, stripeClient } from '../_shared/stripe.ts'

export async function handleStripeEvent(req: Request) {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    signature = req.headers.get('stripe-signature')
  if (!secret || !signature) return new Response(null, { status: 400 })
  const stripe = stripeClient()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch {
    return new Response(null, { status: 400 })
  }
  if (event.account && event.type === 'account.updated') {
    try {
      const account = await stripe.accounts.retrieve(event.account)
      const { error } = await backend().rpc('actualiser_compte', {
        c: account.id,
        a: account.charges_enabled && account.payouts_enabled,
      })
      return new Response(null, { status: error ? 500 : 204 })
    } catch {
      return new Response(null, { status: 500 })
    }
  }
  if (!event.account || event.type !== 'checkout.session.completed')
    return new Response(null, { status: 204 })
  const s = event.data.object,
    order = s.metadata?.planning_commande
  if (!isId(order) || s.payment_status !== 'paid')
    return new Response(null, { status: 204 })
  if (typeof s.payment_intent !== 'string')
    return new Response(null, { status: 400 })
  try {
    const { data, error } = await backend().rpc('finaliser_checkout', {
      o: order,
      c: event.account,
      pi: s.payment_intent,
      total: s.amount_total,
      devise: s.currency,
    })
    if (error) throw error
    if (data === 'rembourser')
      await stripe.refunds.create(
        { payment_intent: s.payment_intent },
        {
          stripeAccount: event.account,
          idempotencyKey: 'planning-rembourse-' + s.payment_intent,
        },
      )
    return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 500 })
  }
}
if (import.meta.main) Deno.serve(handleStripeEvent)

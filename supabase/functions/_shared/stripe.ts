import Stripe from 'npm:stripe@18.5.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
export function stripeClient() {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Paiements non configurés')
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })
}
export const backend = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
export const isId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

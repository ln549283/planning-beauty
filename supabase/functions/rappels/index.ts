import { createClient } from 'npm:@supabase/supabase-js@2'
Deno.serve(async (req) => {
  const secret = Deno.env.get('RAPPELS_SECRET')
  if (
    req.method !== 'POST' ||
    !secret ||
    req.headers.get('authorization') !== 'Bearer ' + secret
  )
    return new Response(null, { status: 403 })
  const key = Deno.env.get('BREVO_API_KEY'),
    sender = Deno.env.get('BREVO_SENDER_EMAIL'),
    base = Deno.env.get('APP_URL')
  if (!key || !sender || !base)
    return new Response('Configuration incomplète', { status: 503 })
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data, error } = await db.rpc('prendre_courriers')
  if (error) return new Response(null, { status: 500 })
  let count = 0
  for (const job of data) {
    const date = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Indian/Reunion',
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(job.debut + '+04:00'))
    const url = new URL(base)
    url.searchParams.set('rdv', job.lien)
    let success = false
    try {
      const sent = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: { email: sender, name: job.institut },
          to: [{ email: job.email }],
          subject: job.type + ' · ' + job.institut,
          textContent:
            job.type +
            ' de votre rendez-vous du ' +
            date +
            ' (heure de La Réunion).\n\nGérer votre rendez-vous : ' +
            url,
          headers: { idempotencyKey: job.id },
        }),
        signal: AbortSignal.timeout(6000),
      })
      success = sent.ok
    } catch {
      /* Le prochain passage reprendra les tentatives en attente. */
    }
    const result = await db.rpc('resultat_courrier', {
      j: job.id,
      verrou: job.lease,
      succes: success,
    })
    if (result.error) return new Response(null, { status: 500 })
    if (success) count++
  }
  return Response.json({ envoyes: count })
})

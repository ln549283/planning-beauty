import { createClient } from 'npm:@supabase/supabase-js@2'
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const stamp = (d: Date) =>
  d
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}/, '')
Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t')
  if (req.method !== 'GET' || !token) return new Response(null, { status: 404 })
  const { data, error } = await db.rpc('lire_flux', { t: token })
  if (error) return new Response(null, { status: 404 })
  const now = stamp(new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Planning Beaute//Agenda//FR',
    'CALSCALE:GREGORIAN',
  ]
  for (const r of data)
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + r.id + '@planning-beaute',
      'DTSTAMP:' + now,
      'DTSTART:' + stamp(new Date(r.debut + '+04:00')),
      'DTEND:' + stamp(new Date(r.fin + '+04:00')),
      'SUMMARY:' + r.libelle,
      'END:VEVENT',
    )
  lines.push('END:VCALENDAR')
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  })
})

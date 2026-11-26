import { createClient } from '@supabase/supabase-js'
export const apiUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://eeuvauqtqhtxnrzvggzt.supabase.co'
export const publicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_8XnvCnxQmFAO7a6CSwEIDg_YQBcoJsq'
export const isDemo = new URLSearchParams(location.search).get('demo') === '1'
export const db = createClient(apiUrl, publicKey, {
  auth: {
    flowType: 'pkce',
    ...(isDemo
      ? {
          storageKey: 'planning-demo-isolated',
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        }
      : {}),
  },
})
export type Institute = {
  id: string
  nom: string
  offre: 'Solo' | 'Premium'
  couleur: string
  fidelite_seuil: number
  fidelite_cadeau: string
  marge: number
  delai_minutes: number
  horizon_jours: number
  horaires: Record<string, string[]>
  ouvert: boolean
}
export type Member = {
  personne: string
  nom: string
  role: 'gerante' | 'responsable' | 'employee'
  photo: string
  actif: boolean
  horaires: Record<string, string[]>
}
export type Service = {
  composition_libre: string
  categorie: string
  id: string
  nom: string
  minutes: number
  centimes: number
  elements: string[]
  habilitations: string[]
  preparation: string
  actif: boolean
  en_ligne: boolean
}
export type Visit = {
  id: string
  personne: string
  cliente_id: string
  soin_id: string
  libelle: string
  preparation: string
  minutes: number
  marge: number
  centimes: number
  debut: string
  fin: string
  derogation?: string
  echeance?: string
  statut: string
  origine: string
}
export type Client = {
  id: string
  nom: string
  email: string | null
  telephone: string
  preferences: string
  notes: string
}
export type Block = {
  id: string
  personnes: string[]
  motif: string
  debut: string
  fin: string
}
export type Card = { id: string; code: string; valeur: number; solde: number }
export type Movement = {
  id: string
  rdv: string
  cliente: string
  carte: string
  type: string
  centimes: number
  created_at: string
}
export type ExceptionDay = {
  id: string
  personne: string | null
  jour: string
  plages: string[]
}
export type Waiting = {
  id: string
  nom: string
  contact: string
  soin: string
  jour: string
}
export type State = {
  members: Member[]
  services: Service[]
  visits: Visit[]
  clients: Client[]
  blocks: Block[]
  cards: Card[]
  money: Movement[]
  exceptions: ExceptionDay[]
  waiting: Waiting[]
}
export async function rpc<T = unknown>(
  name: string,
  params: Record<string, unknown>,
) {
  if (isDemo) return (await import('./demo/database')).demoRpc<T>(name, params)
  const { data, error } = await db.rpc(name, params)
  if (error) throw new Error(error.message)
  return data as T
}
export async function rows<T>(table: string, i?: string): Promise<T[]> {
  if (isDemo) return (await import('./demo/database')).demoRows<T>(table, i)
  const all: T[] = []
  const size = 250
  for (let offset = 0; ; offset += size) {
    const query = db
      .from(table)
      .select('*')
      .order(table === 'equipe' ? 'personne' : 'id')
      .range(offset, offset + size - 1)
    const { data, error } = await (i ? query.eq('institut_id', i) : query)
    if (error) throw new Error(error.message)
    all.push(...(data as T[]))
    if (data.length < size) return all
  }
}
export async function loadState(i: string): Promise<State> {
  const [
    members,
    services,
    visits,
    clients,
    blocks,
    cards,
    money,
    exceptions,
    waiting,
  ] = await Promise.all([
    rows<Member>('equipe', i),
    rows<Service>('soins', i),
    rows<Visit>('rendez_vous', i),
    rows<Client>('clientes', i),
    rows<Block>('blocages', i),
    rows<Card>('cartes', i),
    rows<Movement>('mouvements', i),
    rows<ExceptionDay>('exceptions_horaires', i),
    rows<Waiting>('attente', i),
  ])
  return {
    members,
    services,
    visits,
    clients,
    blocks,
    cards,
    money,
    exceptions,
    waiting,
  }
}
export const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    n / 100,
  )
export const today = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Indian/Reunion' }).format(
    new Date(),
  )
export const dayAdd = (day: string, n: number) =>
  new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10)
export const isoDay = (day: string) =>
  new Date(day + 'T12:00:00Z').getUTCDay() || 7
export const dayName = (
  day: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  },
) =>
  new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' }).format(
    new Date(day + 'T12:00:00Z'),
  )
export const hour = (date: string) => date.slice(11, 16)
export const minutes = (hour: string) =>
  Number(hour.slice(0, 2)) * 60 + Number(hour.slice(3, 5))
export const clock = (min: number) =>
  String(Math.floor(min / 60)).padStart(2, '0') +
  ':' +
  String(min % 60).padStart(2, '0')
export const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
export const link = (name: string, id: string) =>
  location.origin +
  location.pathname +
  '?' +
  new URLSearchParams({ [name]: id })
export const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Une erreur est survenue.'

export function theme(color: string) {
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
  const [r, g, b] = rgb.map((x) =>
    x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
  )
  return {
    '--accent': color,
    '--on-accent':
      0.2126 * r + 0.7152 * g + 0.0722 * b > 0.183 ? '#07120c' : '#ffffff',
  } as import('react').CSSProperties
}

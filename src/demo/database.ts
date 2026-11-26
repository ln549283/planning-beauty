import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import bootstrap from './bootstrap.sql?raw'
import exemples from './exemples.sql?raw'

const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
})
async function open() {
  const pg = await PGlite.create({ extensions: { btree_gist } })
  try {
    await pg.exec(bootstrap)
    for (const file of Object.keys(migrations).sort())
      await pg.exec(migrations[file])
    await pg.exec(exemples)
    const functions = await pg.query<{ proname: string; proretset: boolean }>(
      "select proname,proretset from pg_proc where pronamespace='public'::regnamespace",
    )
    return {
      pg,
      functions: new Map(functions.rows.map((f) => [f.proname, f.proretset])),
    }
  } catch (error) {
    await pg.close()
    throw error
  }
}
// This database lives in this tab's memory. No credentials or production data are copied.
const ready = open()
function identifier(value: string) {
  if (!/^[a-z_]+$/.test(value))
    throw Error('Identifiant de démonstration invalide')
  return '"' + value + '"'
}
export async function demoRows<T>(
  table: string,
  institute?: string,
): Promise<T[]> {
  const { pg } = await ready
  const result = await pg.query<{ value: T }>(
    `select to_jsonb(t) as value from public.${identifier(table)} t ${institute ? 'where institut_id=$1' : ''} order by ${table === 'equipe' ? 'personne' : 'id'}`,
    institute ? [institute] : [],
  )
  return result.rows.map((row) => row.value)
}
export async function demoRpc<T>(
  name: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { pg, functions } = await ready
  if (!functions.has(name)) throw Error('Fonction inconnue')
  const args = Object.keys(params)
    .map((key, n) => identifier(key) + ' => $' + (n + 1))
    .join(',')
  const result = await pg.query<{ value: unknown }>(
    `select to_jsonb(r) as value from public.${identifier(name)}(${args}) as r`,
    Object.values(params),
  )
  return (
    functions.get(name)
      ? result.rows.map((row) => row.value)
      : result.rows[0]?.value
  ) as T
}

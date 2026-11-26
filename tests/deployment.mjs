import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import test from 'node:test'

test('le PATCH Auth utilise le préréglage fort du contrat Supabase', async (t) => {
  const versions = readdirSync(
    new URL('../supabase/migrations/', import.meta.url),
  )
  // Published enum: supabase/supabase, apps/docs/spec/api_v1_openapi.json,
  // UpdateAuthConfigBody.password_required_characters (433d95a).
  const expected =
    'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:' +
    "!@#$%^&*()_+-=[]{};'" +
    String.raw`\\:"` +
    '|<>?,./`~'
  let config = {},
    applied = false
  const original = process.env.SUPABASE_ACCESS_TOKEN
  process.env.SUPABASE_ACCESS_TOKEN = 'sbp_local_test'
  t.after(() => {
    if (original === undefined) delete process.env.SUPABASE_ACCESS_TOKEN
    else process.env.SUPABASE_ACCESS_TOKEN = original
  })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url)
    if (pathname.endsWith('/config/auth')) {
      if (options.method === 'PATCH') {
        config = JSON.parse(options.body)
        assert.equal(config.password_required_characters, expected)
        assert.equal(config.password_min_length, 8)
        applied = true
      }
      return Response.json(config)
    }
    assert(pathname.endsWith('/database/query') && applied)
    return Response.json(versions.map((version) => ({ version })))
  })
  await import('../scripts/deployer.mjs')
  assert(applied)
})

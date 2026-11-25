#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TEST_DB_PASSWORD="$(openssl rand -hex 24)"
export TEST_JWT_SECRET="$(openssl rand -hex 40)"
export TEST_AUTOCONFIRM=false
project="planning-recette-$(openssl rand -hex 6)"
compose=(docker compose -p "$project" -f tests/integration/compose.yml)
trap '"${compose[@]}" down --volumes --remove-orphans >/dev/null' EXIT
"${compose[@]}" up -d --wait db mail
"${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -c 'create schema auth; create role anon; create role authenticated; create role service_role;'
ready(){
 for ((i=0;i<60;i++)); do
   if curl -fsS http://127.0.0.1:59999/health >/dev/null 2>&1; then return 0; fi
   sleep 1
 done
 return 1
}
"${compose[@]}" up -d auth
ready
node tests/integration/auth.mjs
TEST_RESEND=true node tests/integration/auth.mjs
"${compose[@]}" up -d rest
node tests/integration/browser.mjs
export TEST_AUTOCONFIRM=true
"${compose[@]}" up -d auth
ready
node tests/integration/auth.mjs

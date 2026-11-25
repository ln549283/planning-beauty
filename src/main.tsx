import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import { Check, ChevronLeft } from 'lucide-react'
import {
  apiUrl,
  publicKey,
  db,
  field,
  message,
  rows,
  rpc,
  type Institute,
} from './data'
import { Brand, Form } from './ui'
import { VerifiedAccount } from './VerifiedAccount'
import {
  callbackMessage,
  newPassword,
  PasswordFields,
  redirectAfterAuth,
} from './auth'
const Workspace = lazy(async () => ({
  default: (await import('./workspace')).Workspace,
}))
import { PublicBooking, ManageBooking } from './public'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import './style.css'
import { GiftOrderPage } from './payments'

const params = new URLSearchParams(location.search)
const initialAuthError = callbackMessage()
function Auth() {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'resend'>(
      'login',
    ),
    [emailValue, setEmailValue] = useState(''),
    [oauthBusy, setOauthBusy] = useState(false),
    [authError, setAuthError] = useState(initialAuthError),
    [notice, setNotice] = useState(''),
    [plan, setPlan] = useState('Premium')
  const [googleEnabled, setGoogleEnabled] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(new URL('/auth/v1/settings', apiUrl), {
      headers: { apikey: publicKey },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((settings) => setGoogleEnabled(settings?.external?.google === true))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  function change(m: typeof mode) {
    setMode(m)
    setNotice('')
    setAuthError('')
  }
  const accountMode = mode === 'login' || mode === 'signup'
  async function google() {
    setOauthBusy(true)
    setAuthError('')
    try {
      if (mode === 'signup')
        sessionStorage.setItem('planning.oauth.offer', plan)
      else sessionStorage.removeItem('planning.oauth.offer')
      const { error } = await db.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectAfterAuth() },
      })
      if (error) throw error
    } catch (e) {
      setAuthError(message(e))
      setOauthBusy(false)
    }
  }
  return (
    <main className="auth">
      <aside className="photo">
        <Brand />
        <div className="photo-copy">
          <h2>
            Agenda &amp;
            <br />
            <i>réservations.</i>
          </h2>
        </div>
      </aside>
      <section className="auth-body">
        <div className="auth-inner">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="eyebrow">
            <span /> Espace institut
          </div>
          <h1>
            {mode === 'login'
              ? 'Bienvenue.'
              : mode === 'signup'
                ? 'Créer mon compte.'
                : mode === 'resend'
                  ? 'Confirmer mon adresse.'
                  : 'Mot de passe oublié.'}
          </h1>
          <p className="muted">
            {mode === 'login'
              ? 'Connectez-vous pour retrouver votre agenda.'
              : mode === 'signup'
                ? 'Choisissez votre offre et configurez votre institut.'
                : mode === 'resend'
                  ? 'Recevez un lien sécurisé pour vérifier votre adresse et choisir un nouveau mot de passe.'
                  : 'Recevez un lien de réinitialisation par e-mail.'}
          </p>
          {accountMode && (
            <nav className="tabs">
              <button
                className={mode === 'login' ? 'active' : ''}
                onClick={() => change('login')}
              >
                Connexion
              </button>
              <button
                className={mode === 'signup' ? 'active' : ''}
                onClick={() => change('signup')}
              >
                Inscription
              </button>
            </nav>
          )}
          {authError && (
            <p role="alert" className="error">
              {authError}
            </p>
          )}
          {accountMode && googleEnabled && (
            <button
              type="button"
              className="oauth"
              disabled={oauthBusy}
              onClick={google}
            >
              Continuer avec Google
            </button>
          )}
          <Form
            key={mode}
            label={
              mode === 'login'
                ? 'Se connecter  →'
                : mode === 'signup'
                  ? 'Créer mon compte  →'
                  : 'Envoyer le lien'
            }
            submit={async (f) => {
              const email = field(f, 'email'),
                password = String(f.get('password') || '')
              if (mode === 'resend' || mode === 'forgot') {
                const { error } = await db.auth.resetPasswordForEmail(email, {
                  redirectTo: redirectAfterAuth(),
                })
                if (error) throw error
                setNotice(
                  'Ouvrez le dernier lien reçu dans ce navigateur et choisissez un nouveau mot de passe pour accéder à votre institut.',
                )
                return
              }
              if (mode === 'signup') {
                const prenom = field(f, 'prenom'),
                  nom = field(f, 'nom')
                if (!prenom || !nom)
                  throw new Error('Renseignez votre prénom et votre nom.')
                const { data, error } = await db.auth.signUp({
                  email,
                  password: newPassword(f),
                  options: {
                    data: {
                      prenom,
                      nom,
                      full_name: prenom + ' ' + nom,
                      offre: plan,
                    },
                    emailRedirectTo: redirectAfterAuth(),
                  },
                })
                if (error) throw error
                if (!data.session) {
                  change('resend')
                  setNotice(
                    'Ouvrez le lien de confirmation reçu par e-mail dans ce navigateur.',
                  )
                }
                return
              }
              const { error } = await db.auth.signInWithPassword({
                email,
                password,
              })
              if (error?.code === 'email_not_confirmed') {
                change('resend')
                setNotice('Votre adresse attend encore sa confirmation.')
                return
              }
              if (error) throw error
            }}
          >
            {mode === 'signup' && (
              <div className="pair">
                <label>
                  Votre prénom
                  <input
                    name="prenom"
                    autoComplete="given-name"
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  Votre nom
                  <input
                    name="nom"
                    autoComplete="family-name"
                    required
                    maxLength={100}
                  />
                </label>
              </div>
            )}
            <label>
              Adresse e-mail
              <input
                type="email"
                autoComplete="email"
                name="email"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                placeholder="vous@exemple.fr"
                required
              />
            </label>
            {accountMode && <PasswordFields creating={mode === 'signup'} />}
            {mode === 'login' && (
              <button
                className="text-link right"
                type="button"
                onClick={() => change('forgot')}
              >
                Mot de passe oublié ?
              </button>
            )}
            {mode === 'signup' && !params.has('invitation') && (
              <>
                <Plan value={plan} set={setPlan} />
                <small>
                  Les deux offres sont à 0 € au lancement. Aucune carte bancaire
                  requise.
                </small>
              </>
            )}
          </Form>
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {mode === 'login' && (
            <button className="text-link" onClick={() => change('resend')}>
              Renvoyer le lien de confirmation
            </button>
          )}
          {!accountMode && (
            <button className="text-link" onClick={() => change('login')}>
              <ChevronLeft size={14} /> Retour à la connexion
            </button>
          )}
        </div>
      </section>
    </main>
  )
}
function Plan({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <fieldset>
      <legend>Offre de l’institut</legend>
      <div className="plans">
        {['Solo', 'Premium'].map((x) => (
          <label className={x === value ? 'selected' : ''} key={x}>
            <input
              type="radio"
              name="offre"
              value={x}
              checked={x === value}
              onChange={() => set(x)}
            />
            <b>{x} · 0 €</b>
            <small>
              {x === 'Solo' ? 'Agenda solo' : 'Équipe et statistiques'}
            </small>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
function Home({ session }: { session: Session }) {
  const [institutes, setInstitutes] = useState<Institute[] | null>(null),
    [id, setId] = useState(''),
    [creating, setCreating] = useState(false),
    [err, setErr] = useState('')
  const [offer, setOffer] = useState(
    (session.user.user_metadata.offre ??
      (session.user.app_metadata.provider === 'google'
        ? sessionStorage.getItem('planning.oauth.offer')
        : null)) === 'Solo'
      ? 'Solo'
      : 'Premium',
  )
  async function refresh() {
    const list = await rows<Institute>('instituts')
    setInstitutes(list.sort((a, b) => a.nom.localeCompare(b.nom)))
    setId((prev) =>
      list.some((a) => a.id === prev)
        ? prev
        : list.find((a) => a.id === params.get('marchand'))?.id ||
          list[0]?.id ||
          '',
    )
  }
  useEffect(() => {
    refresh().catch((e) => setErr(message(e)))
  }, [session.user.id])
  const needsGoogleName =
    session.user.app_metadata.provider === 'google' &&
    !session.user.user_metadata.nom
  const institute = institutes?.find((v) => v.id === id)
  const invite = params.get('invitation')
  if (invite || creating || institutes?.length === 0)
    return (
      <main className="onboard">
        <Brand />
        <article className="paper">
          <h1>{invite ? 'Rejoindre l’équipe' : 'Créer mon institut'}</h1>
          <Form
            label={invite ? 'Accepter l’invitation' : 'Créer mon institut'}
            submit={async (f) => {
              if (needsGoogleName) {
                const prenom = field(f, 'prenom'),
                  nom = field(f, 'familyName')
                if (!prenom || !nom)
                  throw new Error('Renseignez votre prénom et votre nom.')
                const { error } = await db.auth.updateUser({
                  data: { prenom, nom, full_name: prenom + ' ' + nom },
                })
                if (error) throw error
              }
              const newId = invite
                ? await rpc<string>('rejoindre', {
                    t: invite,
                    n: field(f, 'prenom'),
                  })
                : await rpc<string>('creer_institut', {
                    nom: field(f, 'nom'),
                    offre: offer,
                    prenom: field(f, 'prenom'),
                  })
              if (invite) {
                params.delete('invitation')
                history.replaceState(null, '', location.pathname)
              }
              sessionStorage.removeItem('planning.oauth.offer')
              await refresh()
              setId(newId)
              setCreating(false)
            }}
          >
            <label>
              Votre prénom
              <input
                name="prenom"
                defaultValue={
                  session.user.user_metadata.prenom ??
                  session.user.user_metadata.given_name
                }
                required
                maxLength={100}
              />
            </label>
            {needsGoogleName && (
              <label>
                Votre nom
                <input
                  name="familyName"
                  autoComplete="family-name"
                  defaultValue={session.user.user_metadata.family_name}
                  required
                  maxLength={100}
                />
              </label>
            )}
            {!invite && (
              <>
                <label>
                  Nom de l’institut
                  <input name="nom" required maxLength={100} />
                </label>
                <Plan value={offer} set={setOffer} />
                <small>
                  <Check size={14} /> 0 € au lancement, sans carte bancaire.
                </small>
              </>
            )}
          </Form>
          {creating && (
            <button className="text-link" onClick={() => setCreating(false)}>
              Retour
            </button>
          )}
          <button className="text-link" onClick={() => db.auth.signOut()}>
            Se déconnecter
          </button>
        </article>
      </main>
    )
  if (err)
    return (
      <main className="onboard">
        <Brand />
        <div className="paper">
          <h2>Connexion à l’institut</h2>
          <p role="alert">{err}</p>
          <button onClick={() => location.reload()}>Réessayer</button>
        </div>
      </main>
    )
  if (!institute)
    return <div className="onboard">Chargement des instituts…</div>
  return (
    <Workspace
      key={id}
      user={session.user.id}
      institute={institute}
      institutes={institutes!}
      change={setId}
      create={() => setCreating(true)}
      refreshInstitute={refresh}
    />
  )
}
function App() {
  const [session, setSession] = useState<Session | null | undefined>(),
    [reset, setReset] = useState(false)
  useEffect(() => {
    const { data } = db.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setReset(true)
      if (!s) setReset(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  if (params.has('bon')) return <GiftOrderPage id={params.get('bon')!} />
  if (params.has('reservation'))
    return <PublicBooking id={params.get('reservation')!} />
  if (params.has('rdv')) return <ManageBooking token={params.get('rdv')!} />
  if (reset)
    return (
      <main className="onboard">
        <article className="paper">
          <h1>Nouveau mot de passe</h1>
          <Form
            submit={async (f) => {
              const { error } = await db.auth.updateUser({
                password: newPassword(f),
              })
              if (error) throw error
              setReset(false)
            }}
          >
            <PasswordFields creating />
          </Form>
        </article>
      </main>
    )
  if (session === undefined)
    return (
      <div className="onboard">
        <Brand />
      </div>
    )
  return session ? (
    <VerifiedAccount key={session.user.id} session={session}>
      <Home session={session} />
    </VerifiedAccount>
  ) : (
    <Auth />
  )
}
createRoot(document.getElementById('root')!).render(
  <Suspense
    fallback={
      <main className="onboard">
        <Brand />
      </main>
    }
  >
    <App />
  </Suspense>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

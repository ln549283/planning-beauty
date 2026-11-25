import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import { Check, Eye, EyeOff, ChevronLeft } from 'lucide-react'
import { db, field, message, rows, rpc, type Institute } from './data'
import { Brand, Form } from './ui'
const Workspace = lazy(async () => ({
  default: (await import('./workspace')).Workspace,
}))
import { PublicBooking, ManageBooking } from './public'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import './style.css'

const params = new URLSearchParams(location.search)
function Auth() {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login'),
    [show, setShow] = useState(false),
    [notice, setNotice] = useState(''),
    [plan, setPlan] = useState('Premium')
  function change(m: typeof mode) {
    setMode(m)
    setNotice('')
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
                : 'Mot de passe oublié.'}
          </h1>
          <p className="muted">
            {mode === 'login'
              ? 'Connectez-vous pour retrouver votre agenda.'
              : mode === 'signup'
                ? 'Choisissez votre offre et configurez votre institut.'
                : 'Recevez un lien de réinitialisation par e-mail.'}
          </p>
          {mode !== 'forgot' && (
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
              if (mode === 'forgot') {
                const { error } = await db.auth.resetPasswordForEmail(email, {
                  redirectTo: location.origin + location.pathname,
                })
                if (error) throw error
                setNotice('Consultez votre messagerie pour poursuivre.')
                return
              }
              if (mode === 'signup') {
                const { data, error } = await db.auth.signUp({
                  email,
                  password,
                  options: {
                    data: { prenom: field(f, 'prenom'), offre: plan },
                    emailRedirectTo: location.href.split('#')[0],
                  },
                })
                if (error) throw error
                if (!data.session)
                  setNotice(
                    'Confirmez votre adresse avec le lien reçu par e-mail.',
                  )
                return
              }
              const { error } = await db.auth.signInWithPassword({
                email,
                password,
              })
              if (error) throw error
            }}
          >
            {mode === 'signup' && (
              <label>
                Votre prénom
                <input
                  name="prenom"
                  autoComplete="given-name"
                  required
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Adresse e-mail
              <input
                type="email"
                autoComplete="email"
                name="email"
                placeholder="vous@exemple.fr"
                required
              />
            </label>
            {mode !== 'forgot' && (
              <label>
                Mot de passe
                <div className="password">
                  <input
                    name="password"
                    type={show ? 'text' : 'password'}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    required
                    minLength={mode === 'signup' ? 8 : 1}
                  />
                  <button
                    type="button"
                    aria-label={
                      show
                        ? 'Masquer le mot de passe'
                        : 'Afficher le mot de passe'
                    }
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            )}
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
          {mode === 'forgot' && (
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
    session.user.user_metadata.offre === 'Solo' ? 'Solo' : 'Premium',
  )
  async function refresh() {
    const list = await rows<Institute>('instituts')
    setInstitutes(list.sort((a, b) => a.nom.localeCompare(b.nom)))
    setId((prev) =>
      list.some((a) => a.id === prev) ? prev : list[0]?.id || '',
    )
  }
  useEffect(() => {
    refresh().catch((e) => setErr(message(e)))
  }, [session.user.id])
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
              await refresh()
              setId(newId)
              setCreating(false)
            }}
          >
            <label>
              Votre prénom
              <input
                name="prenom"
                defaultValue={session.user.user_metadata.prenom}
                required
                maxLength={100}
              />
            </label>
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
    })
    return () => data.subscription.unsubscribe()
  }, [])
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
                password: String(f.get('password')),
              })
              if (error) throw error
              setReset(false)
            }}
          >
            <label>
              Mot de passe
              <input type="password" minLength={8} required name="password" />
            </label>
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
  return session ? <Home session={session} /> : <Auth />
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

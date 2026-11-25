import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Brand, Form } from './ui'
import { db, rpc } from './data'
import { PasswordFields, newPassword, redirectAfterAuth } from './auth'

type Access = 'accordé' | 'vérification' | 'nouveau mot de passe'
export function VerifiedAccount({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}) {
  const [decision, setDecision] = useState<{ token: string; access: Access }>()
  const access =
    decision?.token === session.access_token ? decision.access : undefined
  const [failure, setFailure] = useState(false)
  const [sent, setSent] = useState(false)
  const [attempt, retry] = useState(0)
  useEffect(() => {
    let active = true
    setFailure(false)
    rpc<Access>('acces_professionnel', {})
      .then((status) => {
        if (active) setDecision({ token: session.access_token, access: status })
      })
      .catch(() => {
        if (active) setFailure(true)
      })
    return () => {
      active = false
    }
  }, [session.access_token, attempt])
  if (!failure && access === 'accordé') return <>{children}</>
  return (
    <main className="onboard">
      <Brand />
      <article className="paper">
        {failure ? (
          <>
            <h1>Accès temporairement indisponible</h1>
            <p>
              Impossible de vérifier votre accès à l’institut. Si le problème
              persiste, contactez la gérante ou l’administrateur de la
              plateforme.
            </p>
            <button onClick={() => retry((n) => n + 1)}>Réessayer</button>
          </>
        ) : access === 'vérification' ? (
          <>
            <h1>Vérifier mon adresse</h1>
            <p>
              Pour accéder à votre institut, confirmez que vous recevez les
              e-mails à <strong>{session.user.email}</strong> et choisissez un
              nouveau mot de passe.
            </p>
            <Form
              label="Recevoir le lien sécurisé"
              submit={async () => {
                if (!session.user.email)
                  throw new Error('Ce compte ne possède pas d’adresse e-mail.')
                const { error } = await db.auth.resetPasswordForEmail(
                  session.user.email,
                  { redirectTo: redirectAfterAuth() },
                )
                if (error) throw error
                setSent(true)
              }}
            />
            {sent && (
              <p role="status">
                Ouvrez le dernier lien reçu dans ce navigateur. Le planning et
                les réservations de votre institut sont conservés.
              </p>
            )}
          </>
        ) : access === 'nouveau mot de passe' ? (
          <>
            <h1>Nouveau mot de passe</h1>
            <Form
              submit={async (f) => {
                const { error } = await db.auth.updateUser({
                  password: newPassword(f),
                })
                if (error) throw error
                retry((n) => n + 1)
              }}
            >
              <PasswordFields creating />
            </Form>
          </>
        ) : (
          <p role="status">Vérification de votre accès…</p>
        )}
        <button
          className="text-link"
          onClick={() => db.auth.signOut({ scope: 'local' })}
        >
          Se déconnecter
        </button>
      </article>
    </main>
  )
}

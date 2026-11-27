import { useEffect, useState } from 'react'
import { message, rows, type Institute } from '../data'
import { PublicBooking, ManageBooking } from '../public'
import { Workspace } from '../workspace'
import { Brand } from '../ui'

export default function DemoApp() {
  const [screen, setScreen] = useState(location.hash.slice(1))
  useEffect(() => {
    const read = () => setScreen(location.hash.slice(1))
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  const [institute, setInstitute] = useState<Institute>(),
    [error, setError] = useState('')
  async function refresh() {
    const [i] = await rows<Institute>('instituts')
    setInstitute(i)
  }
  useEffect(() => {
    refresh().catch((e) => setError(message(e)))
  }, [])
  if (!institute)
    return (
      <main className="onboard">
        <Brand />
        <article className="paper">
          <h1>Institut Démo</h1>
          <p role={error ? 'alert' : 'status'}>
            {error || 'Préparation du planning de démonstration…'}
          </p>
          {error && (
            <button onClick={() => location.reload()}>Réessayer</button>
          )}
          <a href="/">Retour à la connexion</a>
        </article>
      </main>
    )
  if (screen === 'reservation' || screen.startsWith('rdv='))
    return (
      <>
        <a className="demo-back" href="#">
          ← Agenda de démonstration
        </a>
        {screen === 'reservation' ? (
          <PublicBooking id={institute.id} />
        ) : (
          <ManageBooking token={screen.slice(4)} />
        )}
      </>
    )
  return (
    <Workspace
      institute={institute}
      institutes={[institute]}
      user="00000000-0000-4000-8000-000000000001"
      change={() => {}}
      create={() => {}}
      refreshInstitute={refresh}
      defaults={{ prenom: 'Julie', nom: 'Lagon' }}
    />
  )
}

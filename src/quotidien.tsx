import { useEffect, useState } from 'react'
import { field, rpc, message, type Client, type Institute } from './data'
import { Form } from './ui'

export function Notes({
  client,
  reload,
}: {
  client: Client
  reload: () => Promise<void>
}) {
  const [saved, setSaved] = useState(false)
  return (
    <details>
      <summary>Coordonnées, préférences et notes</summary>
      <Form
        label="Enregistrer la fiche"
        submit={async (f) => {
          setSaved(false)
          await rpc('modifier_fiche', {
            c: client.id,
            tel: field(f, 'telephone'),
            pref: field(f, 'preferences'),
            note: field(f, 'notes'),
          })
          await reload()
          setSaved(true)
        }}
      >
        <label>
          Téléphone
          <input
            type="tel"
            autoComplete="tel"
            name="telephone"
            defaultValue={client.telephone}
            maxLength={30}
          />
        </label>
        <label>
          Préférences de soin
          <textarea
            name="preferences"
            defaultValue={client.preferences}
            maxLength={1000}
          />
        </label>
        <label>
          Notes privées de l’équipe
          <textarea name="notes" defaultValue={client.notes} maxLength={2000} />
        </label>
      </Form>
      {saved && <p role="status">Fiche enregistrée.</p>}
    </details>
  )
}
export function Materiel({
  id,
  day,
  kit,
}: {
  id: string
  day: string
  kit: string[]
}) {
  const [checked, setChecked] = useState<string[]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    rpc<string[]>('materiel_prepare', { i: id, j: day })
      .then((r) => {
        if (active) {
          setChecked(r)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [id, day, retry])
  return (
    <section className="paper">
      <h2>Matériel à préparer</h2>
      {error && (
        <p role="alert">
          {error}{' '}
          <button onClick={() => setRetry((x) => x + 1)}>Réessayer</button>
        </p>
      )}
      {kit.map((article) => (
        <label key={article} className="check">
          <input
            type="checkbox"
            disabled={!checked || busy}
            checked={checked?.includes(article) || false}
            onChange={async (e) => {
              const fait = e.target.checked
              setBusy(true)
              try {
                await rpc('cocher_materiel', { i: id, j: day, article, fait })
                setChecked((list) =>
                  fait
                    ? [...(list || []), article]
                    : list?.filter((x) => x !== article),
                )
                setError('')
              } catch (err) {
                setError(message(err))
              } finally {
                setBusy(false)
              }
            }}
          />
          {article}
        </label>
      ))}
    </section>
  )
}
export function LoyaltySettings({
  a,
  refresh,
}: {
  a: Institute
  refresh: () => Promise<void>
}) {
  return (
    <section className="paper">
      <h2>Programme de fidélité</h2>
      <p>
        Un point par euro de soins réalisés et intégralement réglés. Les
        centimes se cumulent. La cliente gagne ses points au moment d’utiliser
        sa carte cadeau.
      </p>
      <Form
        label="Enregistrer le programme"
        submit={async (f) => {
          await rpc('regler_fidelite', {
            i: a.id,
            seuil: Number(f.get('seuil')),
            cadeau: field(f, 'cadeau'),
          })
          await refresh()
        }}
      >
        <label>
          Points nécessaires pour une récompense (0 pour désactiver)
          <input
            type="number"
            min="0"
            max="100000"
            required
            name="seuil"
            defaultValue={a.fidelite_seuil}
          />
        </label>
        <label>
          Récompense remise à l’institut
          <input
            name="cadeau"
            maxLength={120}
            defaultValue={a.fidelite_cadeau}
            placeholder="Par exemple, un soin des mains"
          />
        </label>
      </Form>
    </section>
  )
}
type Wallet = {
  points: number
  seuil: number
  cadeau: string
  historique: { date: string; cadeau: string; points: number }[]
}
export function Loyalty({ client }: { client: string }) {
  const [wallet, set] = useState<Wallet>(),
    [err, setErr] = useState(''),
    [operation, renew] = useState(() => crypto.randomUUID())
  async function read() {
    set(await rpc<Wallet>('ma_fidelite', { c: client }))
    setErr('')
  }
  useEffect(() => {
    read().catch((e) => setErr(message(e)))
  }, [client])
  return (
    <section>
      <h3>Fidélité</h3>
      {err && <p role="alert">{err}</p>}
      {wallet && (
        <>
          <p>
            {wallet.points} points disponibles{' '}
            {wallet.seuil > 0 &&
              '· ' + wallet.cadeau + ' à ' + wallet.seuil + ' points'}
          </p>
          {wallet.seuil > 0 && wallet.points >= wallet.seuil && (
            <Form
              label="Enregistrer la remise du cadeau"
              submit={async () => {
                if (
                  !confirm(
                    'Confirmer la remise du cadeau et déduire les points ?',
                  )
                )
                  return
                await rpc('remettre_cadeau', { c: client, operation })
                await read()
                renew(crypto.randomUUID())
              }}
            />
          )}
          {wallet.historique.map((h, k) => (
            <p key={k}>
              {new Date(h.date).toLocaleDateString('fr-FR', {
                timeZone: 'Indian/Reunion',
              })}{' '}
              · {h.cadeau} · {h.points} points utilisés
            </p>
          ))}
        </>
      )}
    </section>
  )
}

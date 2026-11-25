import { useEffect, useState } from 'react'
import { db, eur, field, link, message, rpc } from './data'
import { Brand, Form } from './ui'

async function stripeAction(action: string, id: string) {
  const { data, error } = await db.functions.invoke('paiement', {
    body: { action, id },
  })
  if (error) {
    const details = await error.context?.json?.().catch(() => null)
    throw new Error(
      details?.error || 'Impossible de joindre le service de paiement.',
    )
  }
  if (data.url) location.assign(data.url)
  return data
}
type Merchant = {
  actif?: boolean
  compte?: string
  mode?: string
  valeur?: number
  vente_bons?: boolean
}
export function PaymentSettings({
  id,
  premium,
}: {
  id: string
  premium: boolean
}) {
  const [merchant, set] = useState<Merchant>(),
    [mode, setMode] = useState('aucun'),
    [err, setError] = useState('')
  async function load() {
    const m = await rpc<Merchant>('mon_marchand', { i: id })
    set(m)
    setMode(m.mode || 'aucun')
    setError('')
  }
  useEffect(() => {
    load().catch((e) => setError(message(e)))
  }, [id])
  return (
    <section className="paper">
      <h2>Paiements des clientes</h2>
      {err && <p role="alert">{err}</p>}
      {merchant && (
        <>
          <p>
            {merchant.actif
              ? 'Compte Stripe actif.'
              : 'Pour accepter une avance en ligne, associez le compte Stripe de cet institut.'}
          </p>
          {!merchant.actif && (
            <Form
              label="Configurer mon compte Stripe"
              submit={async () => {
                await stripeAction('connecter', id)
                await load()
              }}
            />
          )}
          {merchant.compte && (
            <Form
              label="Actualiser le statut Stripe"
              submit={async () => {
                await stripeAction('actualiser', id)
                await load()
              }}
            />
          )}
          {merchant.actif && (
            <Form
              submit={async (f) => {
                await rpc('regler_paiement', {
                  i: id,
                  politique: mode,
                  v:
                    mode === 'pourcentage'
                      ? Number(f.get('v'))
                      : mode === 'fixe'
                        ? Math.round(Number(f.get('v')) * 100)
                        : 0,
                  bons: f.has('bons'),
                })
                await load()
              }}
            >
              <label>
                Paiement à la réservation
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="aucun">Aucun paiement obligatoire</option>
                  <option value="fixe">Avance fixe</option>
                  <option value="pourcentage">Avance en pourcentage</option>
                  <option value="intégral">Paiement intégral</option>
                </select>
              </label>
              {(mode === 'pourcentage' || mode === 'fixe') && (
                <label key={mode}>
                  {mode === 'fixe' ? 'Avance (€)' : 'Pourcentage'}
                  <input
                    type="number"
                    name="v"
                    required
                    min={mode === 'fixe' ? 0.5 : 1}
                    max={mode === 'fixe' ? 100000 : 100}
                    step={mode === 'fixe' ? 0.01 : 1}
                    defaultValue={
                      mode === merchant.mode
                        ? (merchant.valeur || 0) / (mode === 'fixe' ? 100 : 1)
                        : undefined
                    }
                  />
                </label>
              )}
              {premium && (
                <label className="check">
                  <input
                    type="checkbox"
                    name="bons"
                    defaultChecked={merchant.vente_bons}
                  />
                  Vendre les cartes cadeaux en ligne
                </label>
              )}
            </Form>
          )}
        </>
      )}
    </section>
  )
}
export function BuyGift({ id }: { id: string }) {
  return (
    <section className="paper">
      <h2>Offrir une carte cadeau</h2>
      <Form
        label="Commander une carte cadeau"
        submit={async (f) => {
          const t = await rpc<string>('acheter_bon', {
            i: id,
            montant: Math.round(Number(field(f, 'valeur')) * 100),
          })
          location.assign(link('bon', t))
        }}
      >
        <label>
          Valeur offerte (€)
          <input
            type="number"
            min=".50"
            max="1000"
            step=".01"
            name="valeur"
            required
          />
        </label>
      </Form>
    </section>
  )
}
export function PayButton({
  id,
  bon,
  amount,
}: {
  id: string
  bon?: boolean
  amount: number
}) {
  return (
    <Form
      label={'Payer ' + eur(amount) + ' avec Stripe'}
      submit={() => stripeAction(bon ? 'bon' : 'rendez-vous', id)}
    />
  )
}
type GiftOrder = {
  code: string | null
  nom: string
  montant: number
  paye: boolean
  expire: boolean
  solde: number
}
export function GiftOrderPage({ id }: { id: string }) {
  const [gift, set] = useState<GiftOrder | null>(),
    [err, setError] = useState('')
  useEffect(() => {
    let live = true
    async function read() {
      try {
        const g = await rpc<GiftOrder | null>('etat_achat', { t: id })
        if (live) {
          set(g)
          setError('')
        }
      } catch (e) {
        if (live) setError(message(e))
      }
    }
    read()
    const timer = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        !gift?.paye &&
        !gift?.expire
      )
        read()
    }, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [id, gift?.paye, gift?.expire])
  return (
    <main className="onboard">
      <Brand />
      <article className="paper gift-paper">
        <small>{gift?.nom}</small>
        <h1>Carte cadeau</h1>
        {err && <p role="alert">{err}</p>}
        {gift === null && <p>Bon introuvable.</p>}
        {gift && (
          <>
            <h2>{eur(gift.montant)}</h2>
            {gift.paye ? (
              <>
                <p>
                  N° du bon <strong>{gift.code}</strong>
                </p>
                <p>Solde disponible · {eur(gift.solde)}</p>
                <button onClick={() => window.print()}>
                  Imprimer la carte
                </button>
              </>
            ) : gift.expire ? (
              <p>Cette commande a expiré.</p>
            ) : (
              <>
                <p>
                  Conservez ce lien pour retrouver la carte après le paiement.
                </p>
                <PayButton id={id} amount={gift.montant} bon />
              </>
            )}
          </>
        )}
      </article>
    </main>
  )
}

import { useEffect, useState } from 'react'
import { field, message, rpc, today } from './data'
import { Form, Heading } from './ui'

type ProfileData = {
  prenom: string
  nom: string
  sexe: string
  naissance: string | null
  rue: string
  complement: string
  code_postal: string
  ville: string
  pays: string
}
export function Profile({
  defaults,
}: {
  defaults: { prenom: string; nom: string }
}) {
  const [profile, setProfile] = useState<ProfileData | null>(),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    rpc<ProfileData | null>('mon_profil', {})
      .then((p) => {
        if (active) {
          setProfile(p)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [attempt])
  return (
    <>
      <Heading title="Mon profil" />
      <section className="paper">
        <h2>Informations personnelles</h2>
        <p>
          Ces informations sont privées et communes à vos instituts. Votre
          prénom professionnel se trouve dans l’équipe.
        </p>
        {error && (
          <p role="alert">
            {error}{' '}
            <button onClick={() => setAttempt((n) => n + 1)}>Réessayer</button>
          </p>
        )}
        {profile === undefined ? (
          !error && <p>Chargement…</p>
        ) : (
          <div onChange={() => setSaved(false)}>
            <Form
              submit={async (f) => {
                const data = Object.fromEntries(
                  [
                    'prenom',
                    'nom',
                    'sexe',
                    'rue',
                    'complement',
                    'code_postal',
                    'ville',
                    'pays',
                  ].map((k) => [k, field(f, k)]),
                )
                await rpc('enregistrer_profil', {
                  ...data,
                  naissance: field(f, 'naissance') || null,
                })
                setSaved(true)
              }}
            >
              <div className="pair">
                <label>
                  Prénom
                  <input
                    name="prenom"
                    autoComplete="given-name"
                    defaultValue={profile?.prenom ?? defaults.prenom}
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  Nom
                  <input
                    name="nom"
                    autoComplete="family-name"
                    defaultValue={profile?.nom ?? defaults.nom}
                    maxLength={100}
                    required
                  />
                </label>
              </div>
              <div className="pair">
                <label>
                  Sexe
                  <select
                    name="sexe"
                    defaultValue={profile?.sexe ?? 'Non précisé'}
                  >
                    <option>Femme</option>
                    <option>Homme</option>
                    <option>Autre</option>
                    <option value="Non précisé">Préfère ne pas préciser</option>
                  </select>
                </label>
                <label>
                  Date de naissance (facultative)
                  <input
                    type="date"
                    name="naissance"
                    autoComplete="bday"
                    defaultValue={profile?.naissance ?? ''}
                    max={today()}
                  />
                </label>
              </div>
              <fieldset>
                <legend>Adresse personnelle (facultative)</legend>
                {(
                  [
                    ['rue', 'Rue et numéro', 'address-line1', 200],
                    ['complement', 'Complément', 'address-line2', 200],
                    ['code_postal', 'Code postal', 'postal-code', 20],
                    ['ville', 'Ville', 'address-level2', 100],
                    ['pays', 'Pays', 'country-name', 100],
                  ] as const
                ).map(([k, label, autocomplete, max]) => (
                  <label key={k}>
                    {label}
                    <input
                      name={k}
                      maxLength={max}
                      autoComplete={autocomplete}
                      defaultValue={profile?.[k] ?? ''}
                    />
                  </label>
                ))}
              </fieldset>
            </Form>
          </div>
        )}
        {saved && <p role="status">Profil enregistré.</p>}
      </section>
    </>
  )
}

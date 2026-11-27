import { useEffect, useState } from 'react'
import {
  dayName,
  serviceLabel,
  eur,
  field,
  hour,
  link,
  isDemo,
  message,
  rpc,
  today,
  theme,
  type Service,
  type Member,
} from './data'
import { Brand, Empty, Form } from './ui'
import { BuyGift, PayButton } from './payments'
type Slot = { personne: string; nom: string; debut: string }
export function PublicBooking({ id }: { id: string }) {
  const [catalog, setCatalog] = useState<{
      nom: string
      couleur: string
      soins: (Service & { avance: number })[]
      vente_bons: boolean
      equipe: Member[]
    } | null>(),
    [sid, setSid] = useState(''),
    [replacement, setReplacement] = useState(''),
    [search, setSearch] = useState(''),
    [extras, setExtras] = useState<string[]>([]),
    [policy, setPolicy] = useState<{
      mode: string
      valeur: number
      disponible: boolean
    }>(),
    [operation, setOperation] = useState(() => crypto.randomUUID()),
    [day, setDay] = useState(today()),
    [slots, setSlots] = useState<Slot[]>([]),
    [selected, setSelected] = useState<Slot>(),
    [err, setErr] = useState(''),
    [who, setWho] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, refresh] = useState(0)
  useEffect(() => {
    Promise.all([
      rpc<typeof catalog>('catalogue_public', { i: id }),
      rpc<typeof policy>('politique_publique', { i: id }),
    ])
      .then(([c, p]) => {
        setPolicy(p)
        setCatalog(c)
        setSid(c?.soins[0]?.id || '')
      })
      .catch((e) => setErr(message(e)))
  }, [id])
  const primary = catalog?.soins.find((s) => s.id === sid)
  const effective = replacement || sid
  const selection = [effective, ...extras]
  const suggestions = (primary?.suggestions || []).flatMap(
    (id) => catalog?.soins.filter((s) => s.id === id) || [],
  )
  const included =
    catalog?.soins.find((s) => s.id === effective)?.elements || []
  const otherServices = (catalog?.soins || []).filter(
    (s) =>
      s.id !== sid &&
      s.id !== replacement &&
      !included.includes(s.id) &&
      !suggestions.some((x) => x.id === s.id),
  )
  const soins = selection
    .map((id) => catalog?.soins.find((s) => s.id === id))
    .filter((s) => !!s)
  const price = soins.reduce((sum, s) => sum + s.centimes, 0),
    duration = soins.reduce((sum, s) => sum + s.minutes, 0)
  const deposit =
    policy?.mode === 'fixe'
      ? Math.min(price, policy.valeur)
      : policy?.mode === 'pourcentage'
        ? Math.round((price * policy.valeur) / 100)
        : policy?.mode === 'intégral'
          ? price
          : 0
  useEffect(() => {
    setOperation(crypto.randomUUID())
  }, [selected])
  useEffect(() => {
    let live = true
    setSelected(undefined)
    setSlots([])
    if (!sid || !day) return
    setLoading(true)
    rpc<Slot[]>('creneaux_selection', {
      i: id,
      ids: [effective, ...extras],
      jour: day,
    })
      .then((s) => {
        if (live) {
          setSlots(s)
          setWho((previous) =>
            s.some((slot) => slot.personne === previous) ? previous : '',
          )
        }
      })
      .catch((e) => {
        if (live) setErr(message(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [day, effective, extras, id, revision])
  return (
    <main
      className="onboard"
      style={catalog ? theme(catalog.couleur) : undefined}
    >
      <Brand />
      <article className="paper">
        <div className="eyebrow">{catalog?.nom}</div>
        <h1>Réserver un soin</h1>
        {err && <p className="error">{err}</p>}
        {catalog === null ? (
          <Empty>Les réservations en ligne sont fermées.</Empty>
        ) : catalog ? (
          <>
            {(catalog.soins.length > 6 || search) && (
              <label>
                Rechercher un soin
                <input
                  value={search}
                  placeholder="Nom ou catégorie"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            )}
            <label>
              Prestation
              <select
                aria-label="Prestation"
                value={sid}
                onChange={(e) => {
                  setErr('')
                  setExtras([])
                  setReplacement('')
                  setSid(e.target.value)
                }}
              >
                {catalog.soins
                  .filter(
                    (s) =>
                      s.id === sid ||
                      serviceLabel(s)
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()),
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {serviceLabel(s)} · {s.minutes} min · {eur(s.centimes)}
                    </option>
                  ))}
              </select>
            </label>
            {primary && suggestions.length > 0 && (
              <fieldset>
                <legend>Pour compléter votre soin</legend>
                {suggestions.map((s) => {
                  const swap = primary.remplacements.includes(s.id)
                  const delta = swap
                    ? s.centimes - primary.centimes
                    : s.centimes
                  const time = swap ? s.minutes - primary.minutes : s.minutes
                  if (!swap && included.includes(s.id)) return null
                  return (
                    <label className="check" key={s.id}>
                      <input
                        type="checkbox"
                        checked={
                          swap ? replacement === s.id : extras.includes(s.id)
                        }
                        onChange={(e) => {
                          if (swap) {
                            setReplacement(e.target.checked ? s.id : '')
                            if (e.target.checked)
                              setExtras(
                                extras.filter(
                                  (id) =>
                                    id !== s.id && !s.elements.includes(id),
                                ),
                              )
                          } else {
                            setExtras(
                              e.target.checked
                                ? [...extras, s.id]
                                : extras.filter((x) => x !== s.id),
                            )
                          }
                        }}
                      />
                      {swap ? 'Passer à la formule' : 'Ajouter'}{' '}
                      {serviceLabel(s)} · {delta > 0 ? '+' : ''}
                      {eur(delta)} ·{' '}
                      {time === 0
                        ? 'même durée'
                        : (time > 0 ? '+' : '') + time + ' min'}
                    </label>
                  )
                })}
              </fieldset>
            )}
            {otherServices.length > 0 && (
              <details>
                <summary>Ajouter des soins à la suite</summary>
                {otherServices.map((s) => (
                  <label className="check" key={s.id}>
                    <input
                      type="checkbox"
                      checked={extras.includes(s.id)}
                      onChange={(e) =>
                        setExtras(
                          e.target.checked
                            ? [...extras, s.id]
                            : extras.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {serviceLabel(s)} · {s.minutes} min · {eur(s.centimes)}
                  </label>
                ))}
              </details>
            )}
            {(extras.length > 0 || replacement) && (
              <p>
                {duration} min de soins · {eur(price)}
              </p>
            )}
            {policy?.disponible === false && (
              <p role="alert">
                Le paiement en ligne est temporairement indisponible. Contactez
                votre institut pour réserver.
              </p>
            )}
            <label>
              Date à La Réunion
              <input
                type="date"
                min={today()}
                value={day}
                onChange={(e) => {
                  setErr('')
                  setDay(e.target.value)
                }}
              />
            </label>
            {catalog.equipe?.length > 1 && (
              <label>
                Professionnelle
                <select
                  value={who}
                  onChange={(e) => {
                    setWho(e.target.value)
                    setSelected(undefined)
                  }}
                >
                  <option value="">Aucune préférence</option>
                  {catalog.equipe
                    .filter((m) => slots.some((s) => s.personne === m.personne))
                    .map((m) => (
                      <option key={m.personne} value={m.personne}>
                        {m.nom}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <h3>Créneaux disponibles</h3>
            {loading ? (
              'Recherche…'
            ) : !slots.length ? (
              <Empty>Aucun créneau à cette date.</Empty>
            ) : (
              <select
                aria-label="Choisir un créneau"
                value={selected ? slots.indexOf(selected) : ''}
                onChange={(e) =>
                  setSelected(
                    e.target.value === ''
                      ? undefined
                      : slots[Number(e.target.value)],
                  )
                }
              >
                <option value="">Choisir un horaire</option>
                {slots.map(
                  (s, n) =>
                    (!who || s.personne === who) && (
                      <option key={s.personne + s.debut} value={n}>
                        {hour(s.debut)} · {s.nom}
                      </option>
                    ),
                )}
              </select>
            )}
            {selected &&
              catalog.equipe?.find((m) => m.personne === selected.personne)
                ?.photo && (
                <img
                  className="avatar"
                  src={
                    catalog.equipe.find(
                      (m) => m.personne === selected.personne,
                    )!.photo
                  }
                  alt={selected.nom}
                />
              )}
            {selected && policy?.disponible && (
              <Form
                label={
                  deposit
                    ? 'Réserver et passer au paiement'
                    : 'Confirmer ma réservation'
                }
                submit={async (f) => {
                  try {
                    const token = await rpc<string>('reserver_selection', {
                      i: id,
                      p: selected.personne,
                      ids: selection,
                      prix: price,
                      duree: duration,
                      operation,
                      d: selected.debut,
                      n: field(f, 'nom'),
                      email: field(f, 'email'),
                    })
                    location.assign(
                      isDemo ? '#rdv=' + token : link('rdv', token),
                    )
                  } catch (e) {
                    if (message(e).includes('indisponible'))
                      refresh((v) => v + 1)
                    setErr(message(e))
                    throw e
                  }
                }}
              >
                {deposit > 0 && (
                  <p>
                    À régler maintenant · {eur(deposit)}. Ouvrez Stripe dans les
                    4 minutes suivant la réservation pour bénéficier des 35
                    minutes de paiement.
                  </p>
                )}
                <label>
                  Prénom et nom
                  <input
                    name="nom"
                    required
                    autoComplete="name"
                    maxLength={120}
                  />
                </label>
                <label>
                  E-mail
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </label>
              </Form>
            )}
          </>
        ) : (
          !err && 'Chargement…'
        )}
      </article>
      {catalog?.vente_bons && <BuyGift id={id} />}
    </main>
  )
}
export function ManageBooking({ token }: { token: string }) {
  const [visit, setVisit] = useState<{
      avance: number
      echeance: string
      libelle: string
      statut: string
      debut: string
      centimes: number
      minutes: number
    }>(),
    [err, setErr] = useState('')
  async function get(annuler = false) {
    setVisit(await rpc('mon_rdv', { t: token, annuler }))
    setErr('')
  }
  useEffect(() => {
    get().catch((e) => setErr(message(e)))
  }, [token])
  useEffect(() => {
    if (visit?.statut !== 'en paiement') return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible')
        get().catch((e) => setErr(message(e)))
    }, 5000)
    return () => clearInterval(timer)
  }, [token, visit?.statut])
  return (
    <main className="onboard">
      <Brand />
      <article className="paper">
        <h1>Mon rendez-vous</h1>
        {err && <p role="alert">{err}</p>}
        {visit && (
          <>
            <div className="pill">{visit.statut}</div>
            <h2>{visit.libelle}</h2>
            <p>
              {dayName(visit.debut.slice(0, 10))} à {hour(visit.debut)} ·{' '}
              {visit.minutes} min · {eur(visit.centimes)}
            </p>
            <p>
              Conservez le lien privé de cette page pour retrouver votre
              réservation.
            </p>
            {visit.statut === 'en paiement' && (
              <>
                <p>
                  Le créneau sera confirmé à réception du paiement. En cas
                  d’annulation après paiement, le montant est disponible en
                  avoir. En cas d’absence sans prévenir, il est conservé par
                  l’institut.
                </p>
                <PayButton id={token} amount={visit.avance} />
                <Form label="Libérer le créneau" submit={() => get(true)} />
              </>
            )}
            {visit.statut === 'confirmé' && (
              <Form
                label="Déplacer mon rendez-vous"
                submit={async (f) => {
                  await rpc('deplacer_invitee', {
                    t: token,
                    d: field(f, 'date'),
                  })
                  await get()
                }}
              >
                <label>
                  Nouvelle date et heure à La Réunion
                  <input type="datetime-local" name="date" required />
                </label>
              </Form>
            )}
            {visit.statut === 'expiré' && (
              <p>
                Le délai de paiement est écoulé. Vous pouvez réserver un nouveau
                créneau auprès de l’institut.
              </p>
            )}
            {visit.statut === 'confirmé' && (
              <Form
                label="Annuler mon rendez-vous"
                submit={async () => {
                  if (confirm('Annuler votre rendez-vous ?')) await get(true)
                }}
              />
            )}
          </>
        )}
      </article>
    </main>
  )
}

import { useEffect, useState } from 'react'
import {
  dayName,
  eur,
  field,
  hour,
  link,
  message,
  rpc,
  today,
  theme,
  type Service,
  type Member,
} from './data'
import { Brand, Empty, Form } from './ui'
type Slot = { personne: string; nom: string; debut: string }
export function PublicBooking({ id }: { id: string }) {
  const [catalog, setCatalog] = useState<{
      nom: string
      couleur: string
      soins: Service[]
      equipe: Member[]
    } | null>(),
    [sid, setSid] = useState(''),
    [day, setDay] = useState(today()),
    [slots, setSlots] = useState<Slot[]>([]),
    [selected, setSelected] = useState<Slot>(),
    [err, setErr] = useState(''),
    [who, setWho] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, refresh] = useState(0)
  useEffect(() => {
    rpc<typeof catalog>('catalogue_public', { i: id })
      .then((c) => {
        setCatalog(c)
        setSid(c?.soins[0]?.id || '')
      })
      .catch((e) => setErr(message(e)))
  }, [id])
  useEffect(() => {
    let live = true
    setSelected(undefined)
    setSlots([])
    if (!sid || !day) return
    setLoading(true)
    setErr('')
    rpc<Slot[]>('creneaux', { i: id, sid, jour: day })
      .then((s) => {
        if (live) setSlots(s)
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
  }, [day, sid, id, revision])
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
            <label>
              Prestation
              <select value={sid} onChange={(e) => setSid(e.target.value)}>
                {catalog.soins.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom} · {s.minutes} min · {eur(s.centimes)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date à La Réunion
              <input
                type="date"
                min={today()}
                value={day}
                onChange={(e) => setDay(e.target.value)}
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
            {selected && (
              <Form
                label="Confirmer ma réservation"
                submit={async (f) => {
                  try {
                    const token = await rpc<string>('reserver', {
                      i: id,
                      p: selected.personne,
                      sid,
                      d: selected.debut,
                      n: field(f, 'nom'),
                      email: field(f, 'email'),
                      web: true,
                    })
                    location.assign(link('rdv', token))
                  } catch (e) {
                    refresh((v) => v + 1)
                    setErr(message(e))
                    throw e
                  }
                }}
              >
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
    </main>
  )
}
export function ManageBooking({ token }: { token: string }) {
  const [visit, setVisit] = useState<{
      libelle: string
      statut: string
      debut: string
      centimes: number
      minutes: number
    }>(),
    [err, setErr] = useState('')
  async function get(annuler = false) {
    setVisit(await rpc('mon_rdv', { t: token, annuler }))
  }
  useEffect(() => {
    get().catch((e) => setErr(message(e)))
  }, [token])
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

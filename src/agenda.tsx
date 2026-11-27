import { useState, useEffect } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarOff,
} from 'lucide-react'
import {
  clock,
  dayAdd,
  dayName,
  eur,
  field,
  hour,
  isoDay,
  minutes,
  rpc,
  today,
  type Institute,
  type State,
  type Visit,
} from './data'
import { MonthGrid, shiftMonth } from './MonthGrid'
import { StaffDates } from './StaffDates'
import { serviceLabel, categoryPath, type Client } from './data'
import { Dialog, Empty, Form, Heading } from './ui'
export type PageProps = {
  a: Institute
  s: State
  user: string
  reload: () => Promise<void>
}
export function Agenda({
  a,
  s,
  user,
  reload,
  initialClient,
}: PageProps & { initialClient?: Client }) {
  function availableServices(member: string) {
    const permitted = (x: State['services'][number]) =>
      !x.habilitations.length || x.habilitations.includes(member)
    return s.services.filter(
      (x) =>
        x.actif &&
        permitted(x) &&
        x.elements.every((id) => {
          const part = s.services.find((service) => service.id === id)
          return !!part && permitted(part)
        }),
    )
  }
  const [search, setSearch] = useState('')
  const [day, setDay] = useState(today()),
    [view, setView] = useState(innerWidth < 720 ? 'Jour' : 'Semaine'),
    [who, setWho] = useState(user),
    [bookMember, setBookMember] = useState(user),
    [force, setForce] = useState(false),
    [modal, setModal] = useState(initialClient ? 'visit' : ''),
    [client, setClient] = useState(initialClient),
    [serviceIds, setServiceIds] = useState<string[]>([
      availableServices(user)[0]?.id || '',
    ]),
    [picked, setPicked] = useState(today() + 'T09:00'),
    [v, setV] = useState<Visit>()
  const me = s.members.find((m) => m.personne === user),
    manager = me?.role === 'gerante' || me?.role === 'responsable'
  const monday = dayAdd(day, 1 - isoDay(day))
  const days =
    view === 'Jour'
      ? [day]
      : Array.from({ length: 7 }, (_, i) => dayAdd(monday, i))
  const displayedMembers = s.members.filter(
    (m) => m.actif && (who === 'all' || m.personne === who),
  )
  const columns = days.flatMap((d) => displayedMembers.map((m) => ({ d, m })))
  const visits = s.visits.filter(
    (v) =>
      (who === 'all' || v.personne === who) &&
      !['annulé', 'expiré'].includes(v.statut) &&
      !(
        v.statut === 'en paiement' &&
        v.echeance &&
        Date.parse(v.echeance) <= Date.now()
      ) &&
      days.includes(v.debut.slice(0, 10)),
  )
  const blocks = s.blocks.filter(
    (b) =>
      (who === 'all' || !b.personnes.length || b.personnes.includes(who)) &&
      b.debut < dayAdd(days.at(-1)!, 1) &&
      b.fin > days[0] + 'T00:00:00',
  )
  const openings = [
    ...Object.values(a.horaires),
    ...s.exceptions.map((x) => x.plages),
  ]
    .flat()
    .map(minutes)
  const start = Math.floor(
    Math.min(
      8 * 60,
      ...openings,
      ...visits.map((x) => minutes(hour(x.debut))),
    ) / 60,
  )
  const end = Math.ceil(
    Math.max(18 * 60, ...openings, ...visits.map((x) => minutes(hour(x.fin)))) /
      60,
  )
  function booking(
    d = day,
    t = '09:00',
    p = who === 'all' ? user : who,
    repeat?: Visit,
  ) {
    setClient(
      repeat ? s.clients.find((c) => c.id === repeat.cliente_id) : undefined,
    )
    setServiceIds(
      repeat
        ? repeat.soins_selection?.length
          ? repeat.soins_selection
          : [repeat.soin_id]
        : [availableServices(p)[0]?.id || ''],
    )
    setForce(false)
    setSearch('')
    setBookMember(p)
    setPicked(d + 'T' + t)
    setModal('visit')
  }
  async function done() {
    await reload()
    setModal('')
    setV(undefined)
  }
  const close = () => {
    setModal('')
    setV(undefined)
  }
  const openHours =
    Object.keys(a.horaires).length > 0 ||
    s.exceptions.some((x) => x.plages.length)
  function isOpen(d: string, h: number, p: string) {
    const matches = s.exceptions.filter((x) => x.jour === d)
    const institute =
      matches.find((x) => !x.personne)?.plages ?? a.horaires[isoDay(d)] ?? []
    const individual = matches.find((x) => x.personne === p)?.plages ??
      s.members.find((m) => m.personne === p)?.horaires[isoDay(d)] ?? [
        '00:00',
        '23:59',
      ]
    return institute.some(
      (from, idx) =>
        idx % 2 === 0 &&
        individual.some(
          (other, n) =>
            n % 2 === 0 &&
            Math.max(h, minutes(from), minutes(other)) <
              Math.min(
                h + 60,
                minutes(institute[idx + 1]),
                minutes(individual[n + 1]),
              ),
        ),
    )
  }
  const month = day.slice(0, 7)
  const counts = new Map<string, number>()
  for (const v of s.visits) {
    if (
      (who === 'all' || v.personne === who) &&
      !['annulé', 'expiré'].includes(v.statut) &&
      !(
        v.statut === 'en paiement' &&
        v.echeance &&
        Date.parse(v.echeance) <= Date.now()
      )
    ) {
      const d = v.debut.slice(0, 10)
      counts.set(d, (counts.get(d) || 0) + 1)
    }
  }
  function step(n: number) {
    if (view === 'Mois' || view === 'Année')
      setDay(shiftMonth(month, n * (view === 'Année' ? 12 : 1)) + '-01')
    else setDay(dayAdd(day, n * (view === 'Jour' ? 1 : 7)))
  }
  const eligible = availableServices(bookMember)
  return (
    <>
      <Heading title="Agenda">
        <button
          onClick={() => {
            setPicked(day + 'T09:00')
            setModal('block')
          }}
          hidden={!manager}
        >
          <CalendarOff /> Bloquer du temps
        </button>
        <button className="primary" onClick={() => booking()}>
          <Plus /> Rendez-vous
        </button>
      </Heading>
      <section className="panel">
        <div className="toolbar">
          <div className="actions">
            <button
              className="icon"
              aria-label="Période précédente"
              onClick={() => step(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              className="icon"
              aria-label="Période suivante"
              onClick={() => step(1)}
            >
              <ChevronRight />
            </button>
            <button
              className="period-button"
              onClick={() => setView(view === 'Mois' ? 'Année' : 'Mois')}
            >
              {view === 'Année'
                ? day.slice(0, 4)
                : view === 'Mois'
                  ? dayName(day, { month: 'long', year: 'numeric' })
                  : view === 'Jour'
                    ? dayName(day)
                    : dayName(monday, { day: 'numeric', month: 'short' }) +
                      ' – ' +
                      dayName(days[6], {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
            </button>
          </div>
          <div className="actions">
            <button onClick={() => setDay(today())}>Aujourd’hui</button>
            <div className="toggle">
              {['Jour', 'Semaine', 'Mois', 'Année'].map((x) => (
                <button
                  key={x}
                  className={view === x ? 'on' : ''}
                  onClick={() => setView(x)}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="agenda-sub">
          <CalendarDays size={15} /> Heure de La Réunion{' '}
          <select
            aria-label="Planning de"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            {manager && s.members.filter((m) => m.actif).length > 1 && (
              <option value="all">Toute l’équipe</option>
            )}
            {s.members
              .filter((m) => m.actif && (manager || m.personne === user))
              .map((m) => (
                <option key={m.personne} value={m.personne}>
                  {m.nom}
                </option>
              ))}
          </select>
        </div>
        {!openHours && (
          <div className="tip">
            Définissez les jours et horaires d’ouverture dans les paramètres
            pour commencer à réserver.
          </div>
        )}
        {view === 'Année' ? (
          <div className="year-grid">
            {Array.from({ length: 12 }, (_, n) => {
              const m = day.slice(0, 4) + '-' + String(n + 1).padStart(2, '0')
              return (
                <button
                  key={m}
                  onClick={() => {
                    setDay(m + '-01')
                    setView('Mois')
                  }}
                >
                  {dayName(m + '-01', { month: 'long' })}
                </button>
              )
            })}
          </div>
        ) : view === 'Mois' ? (
          <MonthGrid
            month={month}
            selected={day}
            counts={counts}
            pick={(d) => {
              setDay(d)
              setView('Jour')
            }}
          />
        ) : (
          <div className="scroll">
            <div
              className={'calendar ' + (view === 'Semaine' ? 'week' : '')}
              style={{
                minWidth: who === 'all' ? 58 + 110 * columns.length : undefined,
                gridTemplateColumns:
                  '58px repeat(' + columns.length + ', minmax(0,1fr))',
              }}
            >
              <div className="dayhead" />
              {columns.map(({ d, m }) => (
                <button
                  key={d + m.personne}
                  className={'dayhead ' + (d === today() ? 'current' : '')}
                  onClick={() => {
                    setDay(d)
                    setView('Jour')
                  }}
                >
                  {dayName(d, { weekday: 'short' })}
                  <b>{d.slice(-2)}</b>
                  {who === 'all' && <small>{m.nom}</small>}
                </button>
              ))}
              <div>
                {Array.from({ length: end - start }, (_, i) => (
                  <div className="hour" key={i}>
                    {clock((i + start) * 60)}
                  </div>
                ))}
              </div>
              {columns.map(({ d, m }) => (
                <div className="daycol" key={d + m.personne}>
                  {Array.from({ length: end - start }, (_, i) => (
                    <button
                      className={
                        'hour slot ' +
                        (isOpen(d, (i + start) * 60, m.personne)
                          ? ''
                          : 'closed-slot')
                      }
                      key={i}
                      aria-label={
                        'Ajouter le ' + d + ' à ' + clock((i + start) * 60)
                      }
                      onClick={() =>
                        booking(d, clock((i + start) * 60), m.personne)
                      }
                    />
                  ))}
                  {blocks
                    .filter(
                      (b) =>
                        (!b.personnes.length ||
                          b.personnes.includes(m.personne)) &&
                        b.debut < dayAdd(d, 1) &&
                        b.fin > d + 'T00:00',
                    )
                    .map((b) => {
                      const from = Math.max(
                          start * 60,
                          b.debut.slice(0, 10) < d ? 0 : minutes(hour(b.debut)),
                        ),
                        to = Math.min(
                          end * 60,
                          b.fin.slice(0, 10) > d ? 1440 : minutes(hour(b.fin)),
                        )
                      return (
                        to > from && (
                          <button
                            className="block event"
                            style={{
                              top: (from / 60 - start) * 66,
                              height: (to - from) * 1.1,
                            }}
                            key={b.id}
                            onClick={() => {
                              setPicked(b.id)
                              setModal('unblock')
                            }}
                          >
                            {b.motif}
                          </button>
                        )
                      )
                    })}
                  {visits
                    .filter(
                      (v) => v.personne === m.personne && v.debut.startsWith(d),
                    )
                    .map((v) => {
                      const service = s.services.find((x) => x.id === v.soin_id)
                      const color =
                        s.colors.find(
                          (c) =>
                            service &&
                            c.categorie === service.categorie &&
                            c.sous_categorie === service.sous_categorie,
                        )?.couleur || a.couleur
                      const person =
                        s.clients.find((c) => c.id === v.cliente_id)?.nom || ''
                      const label = [
                        v.libelle,
                        service && categoryPath(service),
                      ]
                        .filter(Boolean)
                        .join(' — ')
                      return (
                        <button
                          key={v.id}
                          className={
                            'event visit ' +
                            (v.minutes + v.marge < 30 ? 'compact-visit' : '')
                          }
                          title={label + ' · ' + person + ' · ' + hour(v.debut)}
                          aria-label={
                            label + ' · ' + person + ' · ' + hour(v.debut)
                          }
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, ' + color + ' 18%, white)',
                            borderColor: color,
                            top: (minutes(hour(v.debut)) / 60 - start) * 66,
                            height: Math.max(17, (v.minutes + v.marge) * 1.1),
                            borderBottomWidth: Math.min(7, v.marge),
                          }}
                          onClick={() => {
                            setV(v)
                            setModal('detail')
                          }}
                        >
                          <b>{v.libelle}</b>
                          <span>{person}</span>
                          <small>
                            {hour(v.debut)} · {service && categoryPath(service)}
                          </small>
                        </button>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {modal === 'visit' && (
        <Dialog title="Nouveau rendez-vous" close={close}>
          {!s.services.some((s) => s.actif) || !openHours ? (
            <Empty>
              Ajoutez une prestation et des horaires dans votre institut pour
              prendre rendez-vous.
            </Empty>
          ) : (
            <Form
              label="Réserver"
              submit={async (f) => {
                if (
                  force &&
                  !confirm(
                    'Créer ce rendez-vous même si la professionnelle est occupée ou hors horaires ?',
                  )
                )
                  return
                if (force)
                  await rpc('reserver_exception', {
                    i: a.id,
                    p: bookMember,
                    sid: serviceIds[0],
                    d: field(f, 'date'),
                    n: field(f, 'nom'),
                    email: field(f, 'email'),
                    motif: field(f, 'motif'),
                  })
                else
                  await rpc('reserver_comptoir', {
                    i: a.id,
                    p: bookMember,
                    ids: serviceIds,
                    d: field(f, 'date'),
                    cliente: client?.id || null,
                    n: field(f, 'nom'),
                    email: field(f, 'email'),
                  })
                setDay(field(f, 'date').slice(0, 10))
                setView('Jour')
                setWho(bookMember)
                await done()
              }}
            >
              {me?.role === 'gerante' && !client && serviceIds.length === 1 && (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    Autoriser exceptionnellement un conflit de planning
                  </label>
                  {force && (
                    <label>
                      Motif de la dérogation
                      <input name="motif" required maxLength={200} />
                    </label>
                  )}
                </>
              )}
              {manager && s.members.length > 1 && (
                <label>
                  Professionnelle
                  <select
                    value={bookMember}
                    onChange={(e) => {
                      const p = e.target.value
                      setBookMember(p)
                      const allowed = availableServices(p)
                      setServiceIds(
                        serviceIds.map((id) =>
                          allowed.some((x) => x.id === id) ? id : '',
                        ),
                      )
                    }}
                  >
                    {s.members
                      .filter((m) => m.actif)
                      .map((m) => (
                        <option key={m.personne} value={m.personne}>
                          {m.nom}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {eligible.length > 6 && (
                <label>
                  Rechercher une prestation
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nom ou catégorie"
                  />
                </label>
              )}
              {serviceIds.map((id, index) => (
                <label key={index}>
                  {index === 0 ? 'Prestation' : 'Soin suivant'}
                  <select
                    required
                    name={index === 0 ? 'soin' : undefined}
                    value={eligible.some((x) => x.id === id) ? id : ''}
                    onChange={(e) =>
                      setServiceIds(
                        serviceIds.map((v, k) =>
                          k === index ? e.target.value : v,
                        ),
                      )
                    }
                  >
                    <option value="">Choisir une prestation</option>
                    {eligible
                      .filter(
                        (x) =>
                          x.id === id ||
                          serviceLabel(x)
                            .toLocaleLowerCase()
                            .includes(search.toLocaleLowerCase()),
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {serviceLabel(x)} · {x.minutes} min ·{' '}
                          {eur(x.centimes)}
                        </option>
                      ))}
                  </select>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setServiceIds(serviceIds.filter((_, k) => k !== index))
                      }
                    >
                      Retirer ce soin
                    </button>
                  )}
                </label>
              ))}
              {!force && serviceIds.length < 20 && (
                <button
                  type="button"
                  onClick={() => setServiceIds([...serviceIds, ''])}
                >
                  Ajouter un soin
                </button>
              )}
              {!force &&
                picked.length >= 16 &&
                serviceIds.every((id) => eligible.some((x) => x.id === id)) && (
                  <StaffDates
                    institute={a.id}
                    member={bookMember}
                    ids={serviceIds}
                    value={picked}
                    change={setPicked}
                  />
                )}
              <label>
                Date et heure
                <input
                  type="datetime-local"
                  name="date"
                  required
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                />
              </label>
              <label>
                Fiche cliente
                <select
                  value={client?.id || ''}
                  onChange={(e) => {
                    setClient(s.clients.find((c) => c.id === e.target.value))
                    setForce(false)
                  }}
                >
                  <option value="">Saisir les coordonnées</option>
                  {s.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                      {c.email ? ' · ' + c.email : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nom et prénom de la cliente
                <input
                  required
                  name="nom"
                  maxLength={120}
                  key={client?.id || 'new'}
                  defaultValue={client?.nom}
                  readOnly={!!client}
                />
              </label>
              <label>
                E-mail de la cliente
                <input
                  type="email"
                  name="email"
                  list="known"
                  key={client?.id || 'new'}
                  defaultValue={client?.email || ''}
                  readOnly={!!client}
                />
              </label>
              <small>Rendez-vous confirmé sans acompte au comptoir.</small>
              <datalist id="known">
                {s.clients
                  .filter((c) => c.email)
                  .map((c) => (
                    <option key={c.id} value={c.email!}>
                      {c.nom}
                    </option>
                  ))}
              </datalist>
            </Form>
          )}
        </Dialog>
      )}
      {modal === 'block' && (
        <Dialog title="Bloquer du temps" close={close}>
          <Form
            submit={async (f) => {
              const args = {
                i: a.id,
                personnes: f.getAll('people'),
                motif: field(f, 'motif'),
                d: field(f, 'from'),
                f: field(f, 'to'),
              }
              try {
                await rpc('bloquer', { ...args, confirmer: false })
              } catch (e) {
                if (
                  !(
                    e instanceof Error &&
                    e.message.includes('déjà confirmés') &&
                    confirm(
                      'Des rendez-vous existent. Maintenir le blocage et les conserver ?',
                    )
                  )
                )
                  throw e
                await rpc('bloquer', { ...args, confirmer: true })
              }
              await done()
            }}
          >
            <label>
              Motif
              <input
                name="motif"
                required
                placeholder="Réunion, formation, congé…"
              />
            </label>
            <label>
              Début
              <input
                type="datetime-local"
                required
                name="from"
                defaultValue={picked}
              />
            </label>
            <label>
              Fin
              <input
                type="datetime-local"
                required
                name="to"
                defaultValue={picked.slice(0, 10) + 'T10:00'}
              />
            </label>
            <fieldset>
              <legend>Personnes concernées</legend>
              <small>Aucune sélection : toute l’équipe.</small>
              {s.members.map((m) => (
                <label className="check" key={m.personne}>
                  <input type="checkbox" name="people" value={m.personne} />
                  {m.nom}
                </label>
              ))}
            </fieldset>
          </Form>
        </Dialog>
      )}
      {modal === 'unblock' && (
        <Dialog
          title={
            s.blocks.find((b) => b.id === picked)?.motif || 'Indisponibilité'
          }
          close={close}
        >
          {manager ? (
            <Form
              label="Retirer le blocage"
              submit={async () => {
                await rpc('debloquer', { b: picked })
                await done()
              }}
            />
          ) : (
            <p>Créneau indisponible.</p>
          )}
        </Dialog>
      )}
      {modal === 'detail' && v && (
        <Dialog title={v.libelle} close={close}>
          {['confirmé', 'réalisé'].includes(v.statut) && (
            <button
              className="primary"
              onClick={() =>
                booking(
                  dayAdd(
                    v.debut.slice(0, 10) > today()
                      ? v.debut.slice(0, 10)
                      : today(),
                    1,
                  ),
                  hour(v.debut),
                  s.members.some((m) => m.actif && m.personne === v.personne)
                    ? v.personne
                    : user,
                  v,
                )
              }
            >
              Reprendre rendez-vous
            </button>
          )}
          <VisitDetail {...{ a, s, v, user, reload: done }} />
        </Dialog>
      )}
    </>
  )
}
function VisitDetail({ s, v, user, reload }: PageProps & { v: Visit }) {
  const [operation] = useState(() => crypto.randomUUID())
  const [action, setAction] = useState(''),
    [mode, setMode] = useState('encaissement')
  const [courriers, setCourriers] = useState<{ type: string; etat: string }[]>(
    [],
  )
  useEffect(() => {
    rpc<{ type: string; etat: string }[]>('suivi_courrier', { r: v.id })
      .then(setCourriers)
      .catch(() => setCourriers([]))
  }, [v.id])
  const paid = s.money
    .filter(
      (m) =>
        m.rdv === v.id &&
        ['encaissement', 'carte utilisée', 'crédit utilisé'].includes(m.type),
    )
    .reduce((n, m) => n + m.centimes, 0)
  return (
    <>
      <h3>{s.clients.find((c) => c.id === v.cliente_id)?.nom}</h3>
      <p>
        {dayName(v.debut.slice(0, 10))} · {hour(v.debut)} —{' '}
        {clock(minutes(hour(v.debut)) + v.minutes)}
      </p>
      <p>
        {v.minutes} min de soin + {v.marge} min de préparation ·{' '}
        {eur(v.centimes)}
      </p>
      <strong className="pill">{v.statut}</strong>
      {v.derogation && <p>Dérogation accordée · {v.derogation}</p>}
      <p>{v.preparation}</p>
      {courriers.length > 0 && (
        <details>
          <summary>Suivi des e-mails</summary>
          {courriers.map((c, i) => (
            <p key={i}>
              {c.type} · {c.etat}
            </p>
          ))}
        </details>
      )}
      {v.statut === 'confirmé' && (
        <div className="actions wrap">
          {(Date.parse(v.debut + '+04:00') > Date.now()
            ? ['Modifier', 'Annuler']
            : ['Modifier', 'Terminer', 'Absence', 'Annuler']
          ).map((x) => (
            <button key={x} onClick={() => setAction(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      {['confirmé', 'réalisé'].includes(v.statut) &&
        s.members.find((m) => m.personne === user)?.role === 'gerante' &&
        paid < v.centimes && (
          <button onClick={() => setAction('Encaisser')}>
            Encaisser · reste {eur(v.centimes - paid)}
          </button>
        )}
      {action && (
        <Form
          key={action}
          label={'Confirmer · ' + action}
          submit={async (f) => {
            if (action === 'Encaisser')
              await rpc('encaisser', {
                operation,
                r: v.id,
                mode,
                montant: Math.round(Number(f.get('somme')) * 100),
                bon: field(f, 'code'),
              })
            else if (action === 'Modifier')
              await rpc('modifier_rdv', {
                r: v.id,
                d: field(f, 'date'),
                p: field(f, 'p'),
                sid: field(f, 'sid'),
              })
            else
              await rpc('statut_rdv', {
                r: v.id,
                s:
                  action === 'Terminer'
                    ? 'réalisé'
                    : action === 'Absence'
                      ? 'absent'
                      : 'annulé',
              })
            await reload()
          }}
        >
          {action === 'Modifier' && (
            <>
              <label>
                Professionnelle
                <select name="p" defaultValue={v.personne}>
                  {s.members
                    .filter((m) => m.actif)
                    .map((m) => (
                      <option key={m.personne} value={m.personne}>
                        {m.nom}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Prestation
                <select name="sid" defaultValue={v.soin_id}>
                  {s.services
                    .filter((x) => x.actif || x.id === v.soin_id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {serviceLabel(x)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Nouvelle date
                <input
                  required
                  type="datetime-local"
                  name="date"
                  defaultValue={v.debut.slice(0, 16)}
                />
              </label>
            </>
          )}
          {action === 'Encaisser' && (
            <>
              <label>
                Mode
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {['encaissement', 'carte utilisée', 'crédit utilisé'].map(
                    (x) => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
              </label>
              {mode === 'carte utilisée' && (
                <label>
                  N° du bon
                  <input required name="code" />
                </label>
              )}
              <label>
                Montant (€)
                <input
                  name="somme"
                  type="number"
                  step=".01"
                  min=".01"
                  max={(v.centimes - paid) / 100}
                  defaultValue={(v.centimes - paid) / 100}
                  required
                />
              </label>
            </>
          )}
          {action === 'Annuler' && (
            <p>Les sommes déjà versées seront recréditées.</p>
          )}
          {action === 'Absence' && (
            <p>Les sommes versées seront conservées par l’institut.</p>
          )}
        </Form>
      )}
    </>
  )
}

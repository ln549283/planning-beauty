import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Flower2,
  Gift,
  LogOut,
  Menu,
  Settings as Gear,
  Users,
  ContactRound,
  X,
} from 'lucide-react'
import { Agenda, type PageProps } from './agenda'
import {
  Settings,
  Services,
  Cards,
  Team,
  CalendarFeed,
  Exceptions,
  Waitlist,
  Offer,
  ExportData,
} from './admin'
import {
  dayAdd,
  dayName,
  db,
  eur,
  hour,
  isoDay,
  link,
  loadState,
  message,
  today,
  theme,
  type Institute,
  type State,
} from './data'
import { Brand, Empty, Heading } from './ui'
const nav = [
  ['Agenda', CalendarDays],
  ['Préparer ma journée', ClipboardList],
  ['Prestations', Flower2],
  ['Clientes', ContactRound],
  ['Cartes cadeaux', Gift],
  ['Tableau de bord', BarChart3],
  ['Équipe', Users],
  ['Liste d’attente', ClipboardList],
  ['Paramètres', Gear],
] as const
export function Workspace({
  user,
  institute: a,
  institutes,
  change,
  create,
  refreshInstitute,
}: {
  user: string
  institute: Institute
  institutes: Institute[]
  change: (id: string) => void
  create: () => void
  refreshInstitute: () => Promise<void>
}) {
  const [s, setState] = useState<State>(),
    [page, setPage] = useState<string>('Agenda'),
    [err, setErr] = useState(''),
    [menu, setMenu] = useState(false)
  const reload = useCallback(async () => {
    const fresh = await loadState(a.id)
    setState(fresh)
    setErr('')
  }, [a.id])
  useEffect(() => {
    const read = () => {
      reload().catch((e) => setErr(message(e)))
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [reload])
  const me = s?.members.find((m) => m.personne === user),
    owner = me?.role === 'gerante'
  const items = nav.filter(
    ([k]) =>
      (owner ||
        !['Cartes cadeaux', 'Tableau de bord', 'Paramètres'].includes(k)) &&
      (k !== 'Liste d’attente' ||
        (a.offre === 'Premium' && me?.role !== 'employee')),
  )
  const props = s ? { a, s, user, reload } : null
  function navigate(p: string) {
    setPage(p)
    setMenu(false)
  }
  return (
    <div className="shell" style={theme(a.couleur)}>
      <button className="mobile-menu" onClick={() => setMenu(!menu)}>
        {menu ? <X /> : <Menu />}
        {a.nom}
      </button>
      <aside className={'side ' + (menu ? 'shown' : '')}>
        <Brand />
        <label className="switcher">
          Institut
          <select
            aria-label="Changer d’institut"
            value={a.id}
            onChange={(e) =>
              e.target.value === 'new' ? create() : change(e.target.value)
            }
          >
            {institutes.map((i) => (
              <option value={i.id} key={i.id}>
                {i.nom}
              </option>
            ))}
            <option value="new">+ Créer un institut</option>
          </select>
        </label>
        <nav>
          {items.map(([k, Icon]) => (
            <button
              key={k}
              className={page === k ? 'active' : ''}
              onClick={() => navigate(k)}
            >
              <Icon size={18} />
              {k}
            </button>
          ))}
        </nav>
        <div className="account">
          <b>{me?.nom}</b>
          <small>{a.offre} · La Réunion</small>
          <button onClick={() => db.auth.signOut()}>
            <LogOut size={16} /> Déconnexion
          </button>
        </div>
      </aside>
      <main className="work">
        <div className="context">
          <span>{a.nom}</span>
          <span>{a.offre} · 0 €</span>
        </div>
        {err && (
          <p className="error">
            {err}{' '}
            <button onClick={() => reload().catch((e) => setErr(message(e)))}>
              Réessayer
            </button>
          </p>
        )}
        {props && s ? (
          <>
            {page === 'Agenda' && <Agenda {...props} />}
            {page === 'Prestations' && <Services {...props} />}
            {page === 'Équipe' && (
              <>
                <Team {...props} />
                <CalendarFeed a={a} />
              </>
            )}
            {page === 'Cartes cadeaux' && owner && <Cards {...props} />}
            {page === 'Liste d’attente' &&
              a.offre === 'Premium' &&
              me?.role !== 'employee' && <Waitlist {...props} />}
            {page === 'Paramètres' && owner && (
              <>
                <Settings
                  a={a}
                  reload={reload}
                  refreshInstitute={refreshInstitute}
                />
                <Exceptions {...props} />
                <ExportData {...props} />
                <Offer a={a} refreshInstitute={refreshInstitute} />
              </>
            )}
            {page === 'Préparer ma journée' && <Prepare {...props} />}
            {page === 'Clientes' && <Clients {...props} />}
            {page === 'Tableau de bord' && owner && <Stats {...props} />}
            {page === 'Agenda' && owner && !a.ouvert && (
              <section className="setup">
                <BookOpen />
                <div>
                  <h3>Configurer mon institut</h3>
                  <p>
                    Renseignez vos prestations et vos horaires, puis ouvrez
                    votre page de réservation.
                  </p>
                </div>
                <button
                  onClick={() =>
                    navigate(s.services.length ? 'Paramètres' : 'Prestations')
                  }
                >
                  Continuer →
                </button>
              </section>
            )}
            {page === 'Agenda' && a.ouvert && (
              <a
                className="public-link"
                href={link('reservation', a.id)}
                target="_blank"
                rel="noreferrer"
              >
                Page de réservation cliente ↗
              </a>
            )}
          </>
        ) : (
          !err && <p>Chargement du planning…</p>
        )}
      </main>
    </div>
  )
}
function Prepare({ a, s }: PageProps) {
  const next =
    Array.from({ length: 7 }, (_, n) => dayAdd(today(), n + 1)).find(
      (d) =>
        a.horaires[isoDay(d)] ||
        s.visits.some((v) => v.debut.startsWith(d) && v.statut === 'confirmé'),
    ) || dayAdd(today(), 1)
  const [day, setDay] = useState(next)
  const visits = s.visits
    .filter((v) => v.debut.startsWith(day) && v.statut === 'confirmé')
    .sort((x, y) => x.debut.localeCompare(y.debut))
  const kit = [
    ...new Set(
      visits.flatMap((v) =>
        v.preparation
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    ),
  ]
  return (
    <>
      <Heading title="Préparer ma journée">
        <input
          type="date"
          aria-label="Jour à préparer"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
      </Heading>
      <section className="panel pad">
        <div className="eyebrow">{dayName(day)}</div>
        <h2>{visits.length} rendez-vous</h2>
        <p>{visits.reduce((n, v) => n + v.minutes, 0)} minutes de soins</p>
        {visits.map((v) => (
          <div className="listrow" key={v.id}>
            <b>{hour(v.debut)}</b>
            <span>
              {v.libelle} · {s.clients.find((c) => c.id === v.cliente_id)?.nom}
            </span>
            {!s.visits.some(
              (x) =>
                x.cliente_id === v.cliente_id &&
                x.statut === 'réalisé' &&
                x.debut < v.debut,
            ) && <small>Première visite</small>}
          </div>
        ))}
      </section>
      {kit.length > 0 && (
        <section className="paper" key={day}>
          <h2>Matériel à préparer</h2>
          {kit.map((k) => (
            <label key={k} className="check">
              <input type="checkbox" />
              {k}
            </label>
          ))}
        </section>
      )}
    </>
  )
}
function Clients({ s, user }: PageProps) {
  const [q, setQ] = useState(''),
    [id, setId] = useState('')
  const person = s.clients.find((c) => c.id === id)
  return (
    <>
      <Heading title="Clientes" />
      <section className="panel pad">
        <label>
          Rechercher une cliente
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom ou adresse e-mail"
          />
        </label>
        {!s.clients.length && (
          <Empty>
            Les fiches clientes apparaîtront dès le premier rendez-vous.
          </Empty>
        )}
        {s.clients
          .filter((c) =>
            (c.nom + ' ' + (c.email || ''))
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
          .map((c) => (
            <button className="listrow" onClick={() => setId(c.id)} key={c.id}>
              <strong>{c.nom}</strong>
              <span>{c.email}</span>
              <ChevronDown size={16} />
            </button>
          ))}
      </section>
      {person && (
        <section className="paper">
          <h2>{person.nom}</h2>
          <p>{person.email}</p>
          <h3>Historique</h3>
          {s.visits
            .filter((v) => v.cliente_id === id)
            .sort((a, b) => b.debut.localeCompare(a.debut))
            .map((v) => (
              <p key={v.id}>
                {dayName(v.debut.slice(0, 10))} · {v.libelle} · {v.statut}
              </p>
            ))}
          {s.members.some(
            (m) => m.role === 'gerante' && m.personne === user,
          ) && (
            <p>
              Crédit disponible ·{' '}
              {eur(
                s.money
                  .filter((m) => m.cliente === id)
                  .reduce(
                    (n, m) =>
                      n +
                      (m.type === 'crédit accordé'
                        ? m.centimes
                        : m.type === 'crédit utilisé'
                          ? -m.centimes
                          : 0),
                    0,
                  ),
              )}
            </p>
          )}
        </section>
      )}
    </>
  )
}
function Stats({ a, s }: PageProps) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [who, setWho] = useState('')
  const visits = s.visits.filter(
      (v) => v.debut.startsWith(month) && (!who || v.personne === who),
    ),
    completed = visits.filter((v) => v.statut === 'réalisé')
  const cash = s.money
    .filter(
      (m) =>
        new Intl.DateTimeFormat('sv-SE', { timeZone: 'Indian/Reunion' })
          .format(new Date(m.created_at))
          .startsWith(month) &&
        ['encaissement', 'vente carte'].includes(m.type) &&
        (!who || s.visits.some((v) => v.id === m.rdv && v.personne === who)),
    )
    .reduce((n, m) => n + m.centimes, 0)
  const total = completed.reduce((n, v) => n + v.centimes, 0)
  const metrics = [
    [
      'Rendez-vous confirmés',
      visits.filter((v) => v.statut === 'confirmé').length,
    ],
    ['Montant encaissé', eur(cash)],
  ]
  if (a.offre === 'Premium')
    metrics.push(
      [
        'Valeur des soins à venir',
        eur(
          visits
            .filter(
              (v) => v.statut === 'confirmé' && v.debut.slice(0, 10) >= today(),
            )
            .reduce((n, v) => n + v.centimes, 0),
        ),
      ],
      [
        'Recette par heure de soin',
        eur((total * 60) / (completed.reduce((n, v) => n + v.minutes, 0) || 1)),
      ],
      [
        'Réservations en ligne',
        visits.filter((v) => v.origine === 'web').length,
      ],
      [
        'Réservations au comptoir',
        visits.filter((v) => v.origine === 'institut').length,
      ],
      ['Valeur des soins réalisés', eur(total)],
      [
        'Panier moyen réalisé',
        eur(completed.length ? total / completed.length : 0),
      ],
      ['Annulations', visits.filter((v) => v.statut === 'annulé').length],
      ['Absences', visits.filter((v) => v.statut === 'absent').length],
    )
  return (
    <>
      <Heading title="Tableau de bord">
        <input
          aria-label="Mois"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        {a.offre === 'Premium' && (
          <select
            aria-label="Professionnelle"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">Tout l’institut</option>
            {s.members.map((m) => (
              <option key={m.personne} value={m.personne}>
                {m.nom}
              </option>
            ))}
          </select>
        )}
      </Heading>
      <div className="tiles">
        {metrics.map(([label, value]) => (
          <article className="tile" key={label}>
            <small>{label}</small>
            <h2>{value}</h2>
          </article>
        ))}
      </div>
      {a.offre === 'Premium' && completed.length > 0 && (
        <section className="paper">
          <h2>Soins réalisés</h2>
          {[...new Set(completed.map((v) => v.libelle))].sort().map((nom) => {
            const soins = completed.filter((v) => v.libelle === nom)
            return (
              <div className="listrow" key={nom}>
                <b>{nom}</b>
                <span>{soins.length} soin(s)</span>
                <span>{eur(soins.reduce((n, v) => n + v.centimes, 0))}</span>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}

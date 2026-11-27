import { useState } from 'react'
import { Plus, Flower2, Clock3, Gift, Scissors } from 'lucide-react'
import {
  eur,
  field,
  link,
  rpc,
  isDemo,
  categoryPath,
  serviceLabel,
  type Service,
} from './data'
import { Dialog, Empty, Form, Heading } from './ui'
import type { PageProps } from './agenda'
import { BulkServices } from './BulkServices'
export function Services({ a, s, user, reload }: PageProps) {
  const [edit, setEdit] = useState<Service | null | undefined>(),
    [kind, setKind] = useState(false),
    [bulk, setBulk] = useState(false)
  const [colorsOpen, setColorsOpen] = useState(false)
  const can = s.members.find((m) => m.personne === user)?.role === 'gerante'
  return (
    <>
      <Heading title="Prestations">
        {can && (
          <>
            {s.colors.length > 0 && (
              <button onClick={() => setColorsOpen(true)}>
                Couleurs des catégories
              </button>
            )}
            <button onClick={() => setBulk(true)}>
              Ajouter plusieurs prestations
            </button>
            <button
              onClick={() => {
                setKind(true)
                setEdit(null)
              }}
            >
              Créer une formule
            </button>
            <button
              className="primary"
              onClick={() => {
                setKind(false)
                setEdit(null)
              }}
            >
              <Plus /> Prestation
            </button>
          </>
        )}
      </Heading>
      {Array.from(new Set(s.services.map(categoryPath)))
        .sort()
        .map((category) => (
          <section key={category}>
            {category && <h2>{category}</h2>}
            <div className="tiles">
              {s.services
                .filter((x) => categoryPath(x) === category)
                .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
                .map((x) => (
                  <article className="tile" key={x.id}>
                    <Flower2 />
                    <small>
                      {x.elements.length || x.composition_libre
                        ? 'Formule'
                        : 'Prestation'}{' '}
                      · {x.actif ? 'Active' : 'Archivée'}
                    </small>
                    <h2>{x.nom}</h2>
                    <p>
                      {x.minutes} min · {eur(x.centimes)}
                    </p>
                    {can && (
                      <button
                        onClick={() => {
                          setKind(
                            x.elements.length > 0 ||
                              Boolean(x.composition_libre),
                          )
                          setEdit(x)
                        }}
                      >
                        Modifier
                      </button>
                    )}
                  </article>
                ))}
            </div>
          </section>
        ))}
      {!s.services.length && (
        <Empty>
          <Scissors />
          <h2>Votre catalogue de soins</h2>
          <p>
            Ajoutez votre première prestation pour la proposer dans l’agenda.
          </p>
        </Empty>
      )}
      {colorsOpen && (
        <Dialog
          title="Couleurs des catégories"
          close={() => setColorsOpen(false)}
        >
          {[...s.colors]
            .sort((a, b) =>
              categoryPath(a).localeCompare(categoryPath(b), 'fr'),
            )
            .map((c) => (
              <Form
                key={c.id}
                label="Appliquer"
                submit={async (f) => {
                  await rpc('colorer_categorie', {
                    i: a.id,
                    ref: c.id,
                    couleur: field(f, 'couleur'),
                  })
                  await reload()
                }}
              >
                <label>
                  {categoryPath(c)}
                  <input type="color" name="couleur" defaultValue={c.couleur} />
                </label>
              </Form>
            ))}
        </Dialog>
      )}
      {bulk && (
        <BulkServices
          i={a.id}
          services={s.services}
          close={() => setBulk(false)}
          finish={async () => {
            await reload()
            setBulk(false)
          }}
        />
      )}
      {edit !== undefined && (
        <Dialog
          title={
            (edit ? 'Modifier' : 'Créer') +
            (kind ? ' une formule' : ' une prestation')
          }
          close={() => setEdit(undefined)}
        >
          <ServiceForm
            {...{ a, s, user, reload }}
            edit={edit}
            kind={kind}
            finish={() => setEdit(undefined)}
          />
        </Dialog>
      )}
    </>
  )
}
function ServiceForm({
  a,
  s,
  reload,
  edit,
  kind,
  finish,
}: PageProps & { edit: Service | null; kind: boolean; finish: () => void }) {
  const [parts, setParts] = useState(edit?.elements || []),
    [fixed, setFixed] = useState(Boolean(edit?.composition_libre)),
    [duration, setDuration] = useState(String(edit?.minutes || '')),
    [price, setPrice] = useState(edit ? String(edit.centimes / 100) : '')
  const [category, setCategory] = useState(edit?.categorie || '')
  const [suggestions, setSuggestions] = useState(edit?.suggestions || [])
  const [replacements, setReplacements] = useState(edit?.remplacements || [])
  function sum(ids: string[]) {
    const items = s.services.filter((x) => ids.includes(x.id))
    setDuration(String(items.reduce((n, x) => n + x.minutes, 0)))
    setPrice(String(items.reduce((n, x) => n + x.centimes, 0) / 100))
  }
  return (
    <Form
      submit={async (f) => {
        if (kind && !fixed && !parts.length)
          throw Error('Sélectionnez les prestations de la formule.')
        await rpc('configurer_soin', {
          sous_categorie: field(f, 'sous_categorie'),
          suggestions,
          remplacements: replacements.filter((id) => suggestions.includes(id)),
          categorie: field(f, 'categorie'),
          composition_libre: kind && fixed ? field(f, 'composition') : '',
          i: a.id,
          sid: edit?.id || null,
          n: field(f, 'nom'),
          duree: Number(duration),
          prix: Math.round(Number(price) * 100),
          composants: fixed ? [] : parts,
          habilitees: f.getAll('people'),
          prep: field(f, 'prep'),
          visible: f.has('online'),
          actif: f.has('active'),
        })
        await reload()
        finish()
      }}
    >
      <label>
        Nom
        <input name="nom" required defaultValue={edit?.nom} maxLength={120} />
      </label>
      <label>
        Catégorie
        <input
          name="categorie"
          list="service-categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          maxLength={80}
        />
      </label>
      <datalist id="service-categories">
        {[...new Set(s.colors.map((c) => c.categorie))].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {category.trim() && (
        <label>
          Sous-catégorie
          <input
            key={category}
            name="sous_categorie"
            list="service-subcategories"
            maxLength={80}
            defaultValue={
              category === edit?.categorie ? edit.sous_categorie : ''
            }
          />
        </label>
      )}
      <datalist id="service-subcategories">
        {s.colors
          .filter((c) => c.categorie === category && c.sous_categorie)
          .map((c) => (
            <option key={c.id} value={c.sous_categorie} />
          ))}
      </datalist>
      {kind && (
        <label>
          Composition de la formule
          <select
            value={fixed ? 'libre' : 'catalogue'}
            onChange={(e) => setFixed(e.target.value === 'libre')}
          >
            <option value="catalogue">Prestations du catalogue</option>
            <option value="libre">Zones incluses, durée et tarif fixes</option>
          </select>
        </label>
      )}
      {kind && fixed && (
        <label>
          Zones incluses
          <input
            name="composition"
            defaultValue={edit?.composition_libre}
            maxLength={500}
            required
          />
        </label>
      )}
      {kind && !fixed && (
        <fieldset>
          <legend>Prestations incluses</legend>
          {s.services
            .filter(
              (x) => !x.elements.length && !x.composition_libre && x.actif,
            )
            .map((x) => (
              <label className="check" key={x.id}>
                <input
                  type="checkbox"
                  checked={parts.includes(x.id)}
                  onChange={(e) => {
                    const ids = e.target.checked
                      ? [...parts, x.id]
                      : parts.filter((p) => p !== x.id)
                    setParts(ids)
                    sum(ids)
                  }}
                />
                {serviceLabel(x)}
              </label>
            ))}
          <button type="button" onClick={() => sum(parts)}>
            Recalculer le prix et la durée
          </button>
        </fieldset>
      )}
      <div className="pair">
        <label>
          Durée (min)
          <input
            required
            type="number"
            min="1"
            max="1200"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label>
          Prix (€)
          <input
            required
            type="number"
            min="0"
            max="100000"
            step=".01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
      </div>
      <small>
        <Clock3 size={14} /> Occupation du planning :{' '}
        {Number(duration) + a.marge} min, préparation incluse.
      </small>
      <label>
        Matériel et préparation
        <textarea name="prep" defaultValue={edit?.preparation} />
      </label>
      {s.members.length > 1 && (
        <fieldset>
          <legend>Professionnelles habilitées</legend>
          <small>Aucune sélection : toute l’équipe.</small>
          {s.members.map((m) => (
            <label className="check" key={m.personne}>
              <input
                type="checkbox"
                name="people"
                value={m.personne}
                defaultChecked={edit?.habilitations.includes(m.personne)}
              />
              {m.nom}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>Prestations complémentaires</legend>
        <small>Proposez jusqu’à trois soins dans l’ordre souhaité.</small>
        {suggestions.map((id, index) => {
          const target = s.services.find((x) => x.id === id)
          if (!target) return null
          return (
            <div key={id} className="suggestion-edit">
              <strong>{serviceLabel(target)}</strong>
              {(target.elements.length > 0 || target.composition_libre) && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={replacements.includes(id)}
                    onChange={(e) =>
                      setReplacements(
                        e.target.checked
                          ? [...replacements, id]
                          : replacements.filter((x) => x !== id),
                      )
                    }
                  />
                  Remplacer le soin initial par cette formule
                </label>
              )}
              <div className="actions">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...suggestions]
                      next.splice(index, 1)
                      next.splice(index - 1, 0, id)
                      setSuggestions(next)
                    }}
                  >
                    Monter
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSuggestions(suggestions.filter((x) => x !== id))
                  }
                >
                  Retirer
                </button>
              </div>
            </div>
          )
        })}
        {suggestions.length < 3 && (
          <label>
            Ajouter une suggestion
            <select
              value=""
              onChange={(e) => setSuggestions([...suggestions, e.target.value])}
            >
              <option value="">Choisir un soin</option>
              {s.services
                .filter(
                  (x) =>
                    x.id !== edit?.id &&
                    x.actif &&
                    x.en_ligne &&
                    !suggestions.includes(x.id),
                )
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {serviceLabel(x)}
                  </option>
                ))}
            </select>
          </label>
        )}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          name="online"
          defaultChecked={edit?.en_ligne ?? true}
        />
        Disponible en ligne
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="active"
          defaultChecked={edit?.actif ?? true}
        />
        Prestation active
      </label>
    </Form>
  )
}
const dayNames = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
]
function CopyHours({
  day,
  lastDay,
  hours,
  copy,
}: {
  day: string
  lastDay: string
  hours: Record<string, string[]>
  copy: (intervals: string[]) => void
}) {
  const source =
    lastDay !== day && hours[lastDay]?.length
      ? lastDay
      : Object.keys(hours)
          .filter((key) => Number(key) < Number(day) && hours[key]?.length)
          .sort((a, b) => Number(b) - Number(a))[0]
  if (!source) return null
  const intervals = hours[source]
  const ranges = intervals
    .filter((_, i) => i % 2 === 0)
    .map((t, i) => t + '–' + intervals[2 * i + 1])
  return (
    <button
      type="button"
      className="text-link"
      onClick={() => copy([...intervals])}
    >
      Copier {dayNames[Number(source) - 1].toLowerCase()} · {ranges.join(' / ')}
    </button>
  )
}
export function Settings({
  a,
  reload,
  refreshInstitute,
}: {
  a: PageProps['a']
  reload: () => Promise<void>
  refreshInstitute: () => Promise<void>
}) {
  const [lastDay, setLastDay] = useState('')
  const [hours, setHours] = useState(a.horaires),
    [saved, setSaved] = useState(false),
    [delay, setDelay] = useState(String(a.delai_minutes)),
    [horizon, setHorizon] = useState(String(a.horizon_jours))

  return (
    <>
      <Heading title="Paramètres" />
      <section className="paper">
        <Form
          submit={async (f) => {
            await rpc('regler_institut', {
              i: a.id,
              n: field(f, 'nom'),
              couleur: field(f, 'color'),
              marge: Number(f.get('margin')),
              horaires: hours,
              delai: Number(f.get('delai')),
              horizon: Number(f.get('horizon')),
              ouvert: f.has('online'),
            })
            await refreshInstitute()
            await reload()
            setSaved(true)
          }}
        >
          <h2>Mon institut</h2>
          <label>
            Nom de l’établissement
            <input name="nom" required defaultValue={a.nom} />
          </label>
          <div className="pair">
            <label>
              Couleur principale
              <input type="color" name="color" defaultValue={a.couleur} />
            </label>
            <label>
              Marge par rendez-vous (min)
              <input
                type="number"
                name="margin"
                min="0"
                max="120"
                required
                defaultValue={a.marge}
              />
            </label>
          </div>
          <h2>Horaires d’ouverture</h2>
          <small>Heure de La Réunion · Indian/Reunion</small>
          {dayNames.map((n, index) => {
            const key = String(index + 1),
              h = hours[key]
            return (
              <div className="hours-row" key={n}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!h}
                    onChange={(e) => {
                      const copy = { ...hours }
                      if (e.target.checked) copy[key] = ['09:00', '17:00']
                      else delete copy[key]
                      setHours(copy)
                    }}
                  />
                  {n}
                </label>
                <CopyHours
                  day={key}
                  lastDay={lastDay}
                  hours={hours}
                  copy={(intervals) => {
                    setHours({ ...hours, [key]: intervals })
                    setLastDay(key)
                  }}
                />
                {h && (
                  <>
                    <div className="times">
                      {h.map((t, j) => (
                        <input
                          aria-label={n + ' · horaire ' + (j + 1)}
                          key={j}
                          type="time"
                          required
                          value={t}
                          onChange={(e) => {
                            setLastDay(key)
                            setHours({
                              ...hours,
                              [key]: h.map((v, k) =>
                                k === j ? e.target.value : v,
                              ),
                            })
                          }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() =>
                        setHours({
                          ...hours,
                          [key]:
                            h.length === 2
                              ? [h[0], '12:00', '13:00', h[1]]
                              : [h[0], h[3]],
                        })
                      }
                    >
                      {h.length === 2
                        ? 'Ajouter une pause'
                        : 'Retirer la pause'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
          <h2>Réservation cliente</h2>
          <div className="pair">
            <label>
              Délai minimum avant le rendez-vous (min)
              <input
                type="number"
                name="delai"
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
                min="0"
                max="43200"
                required
              />
            </label>
            <label>
              Jusqu’à combien de jours peut-on réserver ?
              <input
                type="number"
                name="horizon"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
                min="1"
                max="730"
                required
              />
            </label>
          </div>
          {delay !== '' && horizon !== '' && (
            <p>
              Vos clientes peuvent réserver entre{' '}
              {Number(delay) > 0 && Number(delay) % 60 === 0
                ? Number(delay) / 60 +
                  ' heure' +
                  (Number(delay) > 60 ? 's' : '')
                : delay + ' min'}{' '}
              et {horizon} jour{Number(horizon) > 1 ? 's' : ''} à l’avance.
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              disabled={isDemo}
              name="online"
              defaultChecked={a.ouvert}
            />
            Ouvrir les réservations en ligne
          </label>
          {!isDemo && a.ouvert && (
            <a
              href={link('reservation', a.id)}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir la page de réservation ↗
            </a>
          )}
        </Form>
        {saved && <p role="status">Paramètres enregistrés.</p>}
      </section>
    </>
  )
}
export function Team({ a, s, user, reload }: PageProps) {
  const [url, setUrl] = useState(''),
    [photo, setPhoto] = useState(''),
    [member, setMember] = useState('')
  const can = s.members.find((m) => m.personne === user)?.role === 'gerante'
  return (
    <>
      <Heading title="Équipe" />
      <div className="tiles">
        {s.members.map((m) => (
          <article key={m.personne} className="tile">
            {m.photo ? (
              <img className="avatar" src={m.photo} alt="" />
            ) : (
              <div className="avatar">{m.nom.slice(0, 1)}</div>
            )}
            <h2>{m.nom}</h2>
            <p>
              {!m.actif && 'Accès désactivé · '}
              {
                {
                  gerante: 'Gérant(e)',
                  employee: 'Employée',
                  responsable: 'Responsable des plannings',
                }[m.role]
              }
            </p>
            {can && m.personne !== user && (
              <button onClick={() => setMember(m.personne)}>Gérer</button>
            )}
          </article>
        ))}
      </div>
      {member && (
        <ColleagueEditor
          {...{ a, s, user, reload }}
          id={member}
          close={() => setMember('')}
        />
      )}
      <section className="paper">
        <h2>Mon portrait</h2>
        <Form
          label="Enregistrer le portrait"
          submit={async () => {
            await rpc('portrait', { i: a.id, image: photo })
            await reload()
          }}
        >
          <label>
            Photo (JPEG, PNG ou WebP, 300 Ko maximum)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (
                  f.size > 300000 ||
                  !['image/jpeg', 'image/png', 'image/webp'].includes(f.type)
                ) {
                  e.target.setCustomValidity(
                    'Choisissez une image de 300 Ko maximum.',
                  )
                  e.target.reportValidity()
                  return
                }
                e.target.setCustomValidity('')
                const reader = new FileReader()
                reader.onload = () => setPhoto(String(reader.result))
                reader.readAsDataURL(f)
              }}
            />
          </label>
        </Form>
      </section>
      {can && s.members.some((m) => m.actif && m.personne !== user) && (
        <section className="paper">
          <h2>Transférer la gérance</h2>
          <Form
            label="Transférer la gérance"
            submit={async (f) => {
              const id = field(f, 'destinataire'),
                nom = s.members.find((m) => m.personne === id)?.nom
              if (
                !confirm(
                  'Transférer la gérance de ' +
                    a.nom +
                    ' à ' +
                    nom +
                    ' ? Vous deviendrez responsable des plannings et perdrez l’accès aux finances.',
                )
              )
                return
              await rpc('transferer_gerance', { i: a.id, destinataire: id })
              await reload()
            }}
          >
            <label>
              Nouveau gérant ou nouvelle gérante
              <select required name="destinataire" defaultValue="">
                <option value="">Choisir un membre actif</option>
                {s.members
                  .filter((m) => m.actif && m.personne !== user)
                  .map((m) => (
                    <option key={m.personne} value={m.personne}>
                      {m.nom}
                    </option>
                  ))}
              </select>
            </label>
          </Form>
        </section>
      )}
      {can && !isDemo && (
        <section className="paper">
          <h2>Inviter une collègue</h2>
          {a.offre === 'Premium' ? (
            <Form
              label="Créer le lien d’invitation"
              submit={async (f) => {
                setUrl(
                  link(
                    'invitation',
                    await rpc<string>('inviter', {
                      i: a.id,
                      email: field(f, 'email'),
                      fonction: field(f, 'role'),
                    }),
                  ),
                )
              }}
            >
              <label>
                E-mail de la collègue
                <input required type="email" name="email" />
              </label>
              <label>
                Rôle
                <select name="role">
                  <option value="employee">Employée · son agenda</option>
                  <option value="responsable">
                    Responsable des plannings · tous les agendas
                  </option>
                </select>
              </label>
            </Form>
          ) : (
            <p>L’ajout de collègues est inclus dans l’offre Premium.</p>
          )}
          {url && (
            <label>
              Lien privé à transmettre, valable 7 jours
              <input readOnly value={url} onFocus={(e) => e.target.select()} />
            </label>
          )}
        </section>
      )}
    </>
  )
}
export function Cards({ a, s, reload }: PageProps) {
  const [operation, setOperation] = useState('')
  const [sell, setSell] = useState(false),
    [q, setQ] = useState(''),
    [selected, setSelected] = useState('')
  const card = s.cards.find((c) => c.id === selected)
  return (
    <>
      <Heading title="Cartes cadeaux">
        <button
          className="primary"
          onClick={() => {
            setOperation(crypto.randomUUID())
            setSell(true)
          }}
        >
          <Plus /> Vendre une carte
        </button>
      </Heading>
      <section className="panel pad">
        <label>
          Rechercher un bon
          <input
            value={q}
            placeholder="N° du bon"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {!s.cards.length && (
          <Empty>
            <Gift />
            <h2>Vos bons cadeaux</h2>
            <p>
              Enregistrez une vente pour obtenir le numéro à recopier sur la
              carte.
            </p>
          </Empty>
        )}
        {s.cards
          .filter((c) => c.code.includes(q))
          .map((c) => (
            <button
              className="listrow"
              key={c.id}
              onClick={() => setSelected(c.id)}
            >
              <strong>{c.code}</strong>
              <span>Valeur {eur(c.valeur)}</span>
              <b>{eur(c.solde)} disponibles</b>
            </button>
          ))}
      </section>
      {sell && (
        <Dialog title="Vendre une carte cadeau" close={() => setSell(false)}>
          <Form
            label="Confirmer la vente encaissée"
            submit={async (f) => {
              const code = await rpc<string>('vendre_carte', {
                operation,
                i: a.id,
                montant: Math.round(Number(f.get('amount')) * 100),
              })
              await reload()
              setQ(code)
              setSell(false)
            }}
          >
            <label>
              Valeur offerte (€)
              <input
                name="amount"
                type="number"
                min=".01"
                step=".01"
                required
              />
            </label>
          </Form>
        </Dialog>
      )}
      {card && (
        <Dialog title={'Bon ' + card.code} close={() => setSelected('')}>
          <p>Valeur offerte · {eur(card.valeur)}</p>
          <h2>Solde : {eur(card.solde)}</h2>
          <h3>Historique</h3>
          {s.money
            .filter((m) => m.carte === card.id)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((m) => (
              <p key={m.id}>
                {m.type} · {eur(m.centimes)}
              </p>
            ))}
          <small>
            Pour utiliser le bon, ouvrez le rendez-vous puis « Encaisser ».
          </small>
        </Dialog>
      )}
    </>
  )
}

export function CalendarFeed({ a }: { a: PageProps['a'] }) {
  const [url, setUrl] = useState(''),
    [removed, setRemoved] = useState(false)
  return (
    <section className="paper">
      <h2>Mon calendrier externe</h2>
      <p>
        Abonnez Google Agenda ou Calendrier sur iPhone à vos disponibilités. Les
        rendez-vous apparaissent sans les coordonnées des clientes.
      </p>
      <Form
        label="Obtenir mon lien privé"
        submit={async () => {
          const t = await rpc<string>('mon_calendrier', {
            i: a.id,
            retirer: false,
          })
          setUrl(
            (import.meta.env.VITE_SUPABASE_URL ||
              'https://eeuvauqtqhtxnrzvggzt.supabase.co') +
              '/functions/v1/calendrier?t=' +
              t,
          )
          setRemoved(false)
        }}
      />
      {url && (
        <label>
          Lien d’abonnement iCal
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
        </label>
      )}
      <Form
        label="Révoquer le lien"
        submit={async () => {
          await rpc('mon_calendrier', { i: a.id, retirer: true })
          setUrl('')
          setRemoved(true)
        }}
      />
      {removed && <p>Lien révoqué.</p>}
    </section>
  )
}

export function Exceptions({ a, s, reload }: PageProps) {
  const [closed, setClosed] = useState(false)
  return (
    <section className="paper">
      <h2>Horaires exceptionnels</h2>
      <Form
        submit={async (f) => {
          const j = field(f, 'date'),
            p = field(f, 'who') || null
          const affected = s.visits.some(
            (v) =>
              v.statut === 'confirmé' &&
              v.debut.startsWith(j) &&
              (!p || v.personne === p),
          )
          if (
            affected &&
            !confirm(
              'Il existe des rendez-vous ce jour. Les conserver et modifier les horaires ?',
            )
          )
            return
          await rpc('exception_jour', {
            i: a.id,
            p,
            j,
            h: closed ? [] : [field(f, 'from'), field(f, 'to')],
          })
          await reload()
        }}
      >
        <label>
          Journée
          <input type="date" name="date" required />
        </label>
        <label>
          À qui s’applique ce changement ?
          <select name="who">
            <option value="">Tout l’institut</option>
            {s.members.map((m) => (
              <option key={m.personne} value={m.personne}>
                {m.nom} uniquement
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={closed}
            onChange={(e) => setClosed(e.target.checked)}
          />
          Fermer toute la journée
        </label>
        {!closed && (
          <div className="pair">
            <label>
              Ouverture
              <input type="time" name="from" required />
            </label>
            <label>
              Fermeture
              <input type="time" name="to" required />
            </label>
          </div>
        )}
      </Form>
      {s.exceptions.map((x) => (
        <Form
          key={x.id}
          label="Rétablir les horaires habituels"
          submit={async () => {
            await rpc('exception_jour', {
              i: a.id,
              p: x.personne,
              j: x.jour,
              h: null,
            })
            await reload()
          }}
        >
          <small>
            {x.jour} ·{' '}
            {s.members.find((m) => m.personne === x.personne)?.nom ||
              'Institut'}{' '}
            · {x.plages.join(' – ') || 'Fermé'}
          </small>
        </Form>
      ))}
    </section>
  )
}
export function Waitlist({ a, s, reload }: PageProps) {
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Heading title="Liste d’attente">
        <button className="primary" onClick={() => setAdding(true)}>
          <Plus /> Demande
        </button>
      </Heading>
      <section className="panel pad">
        {!s.waiting.length && <Empty>Aucune demande en attente.</Empty>}
        {s.waiting.map((w) => (
          <Form
            key={w.id}
            label="Retirer la demande"
            submit={async () => {
              await rpc('liste_attente', {
                i: a.id,
                retirer: w.id,
                n: '',
                contact: '',
                sid: null,
                j: null,
              })
              await reload()
            }}
          >
            <h3>{w.nom}</h3>
            <p>
              {w.jour} · {s.services.find((x) => x.id === w.soin)?.nom} ·{' '}
              {w.contact}
            </p>
          </Form>
        ))}
      </section>
      {adding && (
        <Dialog title="Ajouter une demande" close={() => setAdding(false)}>
          <Form
            submit={async (f) => {
              await rpc('liste_attente', {
                i: a.id,
                retirer: null,
                n: field(f, 'nom'),
                contact: field(f, 'contact'),
                sid: field(f, 'sid'),
                j: field(f, 'jour'),
              })
              await reload()
              setAdding(false)
            }}
          >
            <label>
              Cliente
              <input name="nom" required />
            </label>
            <label>
              Contact
              <input name="contact" required />
            </label>
            <label>
              Prestation
              <select required name="sid">
                {s.services
                  .filter((x) => x.actif)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {serviceLabel(x)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Jour souhaité
              <input type="date" name="jour" required />
            </label>
          </Form>
        </Dialog>
      )}
    </>
  )
}
export function Offer({
  a,
  refreshInstitute,
}: {
  a: PageProps['a']
  refreshInstitute: () => Promise<void>
}) {
  return (
    <section className="paper">
      <h2>Abonnement · {a.offre}</h2>
      <Form
        label={
          a.offre === 'Solo' ? 'Activer Premium à 0 €' : 'Passer en Solo à 0 €'
        }
        submit={async () => {
          await rpc('changer_offre', {
            i: a.id,
            offre: a.offre === 'Solo' ? 'Premium' : 'Solo',
          })
          await refreshInstitute()
        }}
      >
        <p>
          Les deux offres sont gratuites au lancement. Premium donne accès à la
          gestion d’équipe, à la liste d’attente et aux statistiques détaillées.
        </p>
      </Form>
    </section>
  )
}

export function ExportData({ s, a }: PageProps) {
  return (
    <section className="paper">
      <h2>Exporter les données</h2>
      <p>Télécharger les données de cet institut au format JSON.</p>
      <button
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify({ institut: a, ...s }, null, 2)], {
              type: 'application/json',
            }),
          )
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = 'institut-' + a.id + '.json'
          anchor.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}
      >
        Télécharger l’export
      </button>
    </section>
  )
}

function ColleagueEditor({
  a,
  s,
  reload,
  id,
  close,
}: PageProps & { id: string; close: () => void }) {
  const m = s.members.find((m) => m.personne === id)!
  const [lastDay, setLastDay] = useState('')
  const [hours, setHours] = useState(m.horaires)
  return (
    <Dialog title={m.nom} close={close}>
      <Form
        submit={async (f) => {
          await rpc('gerer_collegue', {
            i: a.id,
            p: id,
            fonction: field(f, 'role'),
            active: f.has('active'),
            horaires: hours,
          })
          await reload()
          close()
        }}
      >
        <label>
          Rôle
          <select name="role" defaultValue={m.role}>
            <option value="employee">Employée</option>
            <option value="responsable">Responsable des plannings</option>
          </select>
        </label>
        <fieldset>
          <legend>Horaires individuels</legend>
          <small>
            Choisissez les jours qui diffèrent des horaires de l’institut.
          </small>
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day, n) => {
            const k = String(n + 1),
              h = hours[k]
            return (
              <div key={k}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!h}
                    onChange={(e) => {
                      const copy = { ...hours }
                      if (e.target.checked) copy[k] = ['09:00', '17:00']
                      else delete copy[k]
                      setHours(copy)
                    }}
                  />
                  {day}
                </label>
                <CopyHours
                  day={k}
                  lastDay={lastDay}
                  hours={hours}
                  copy={(intervals) => {
                    setHours({ ...hours, [k]: intervals })
                    setLastDay(k)
                  }}
                />
                {h && (
                  <div className="times">
                    {h.map((v, j) => (
                      <input
                        key={j}
                        aria-label={day + ' ' + (j + 1)}
                        type="time"
                        value={v}
                        required
                        onChange={(e) => {
                          setLastDay(k)
                          setHours({
                            ...hours,
                            [k]: h.map((t, i) =>
                              i === j ? e.target.value : t,
                            ),
                          })
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setHours({
                          ...hours,
                          [k]: h.length ? [] : ['09:00', '17:00'],
                        })
                      }
                    >
                      {h.length ? 'Repos' : 'Ajouter des heures'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </fieldset>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={m.actif} />
          Accès actif à l’institut
        </label>
      </Form>
    </Dialog>
  )
}

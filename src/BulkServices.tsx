import { useRef, useState, type ClipboardEvent } from 'react'
import { rpc, type Service } from './data'
import { Dialog, Form } from './ui'

type Line = { id: string; nom: string; minutes: string; prix: string }
const makeLine = (nom = '', minutes = '', prix = ''): Line => ({
  id: crypto.randomUUID(),
  nom,
  minutes,
  prix,
})
const normalize = (value: string) => value.trim().toLocaleLowerCase('fr-FR')
function amounts(line: Line) {
  const duration = line.minutes.trim().replace(/\s*min$/i, '')
  const price = line.prix
    .trim()
    .replace(/\s*€$/, '')
    .replace(/[\s\u202f]/g, '')
    .replace(',', '.')
  return {
    minutes: /^\d+$/.test(duration) ? Number(duration) : NaN,
    centimes: /^\d+(\.\d{1,2})?$/.test(price)
      ? Math.round(Number(price) * 100)
      : NaN,
  }
}
export function BulkServices({
  i,
  services,
  finish,
  close,
}: {
  i: string
  services: Service[]
  finish: () => Promise<void>
  close: () => void
}) {
  const [lines, setLines] = useState<Line[]>(() => [makeLine()]),
    [visible, setVisible] = useState(false),
    [category, setCategory] = useState(''),
    [sub, setSub] = useState(''),
    [checked, setChecked] = useState(false),
    [pasteError, setPasteError] = useState('')
  const [operation] = useState(() => crypto.randomUUID())
  const container = useRef<HTMLDivElement>(null)
  function focus(id: string) {
    requestAnimationFrame(() =>
      container.current
        ?.querySelector<HTMLInputElement>('[data-row="' + id + '"]')
        ?.focus(),
    )
  }
  function add() {
    if (lines.length >= 200) return
    const line = makeLine()
    setLines([...lines, line])
    focus(line.id)
  }
  function paste(e: ClipboardEvent<HTMLInputElement>, index: number) {
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.trimEnd().includes('\n')) return
    e.preventDefault()
    const values = text
      .trimEnd()
      .split(/\r?\n/)
      .map((row) => row.split('\t'))
    if (values.some((c) => c.length !== 3)) {
      setPasteError('Copiez trois colonnes dans l’ordre nom, durée et prix.')
      return
    }
    const added = values.map(([n, m, p]) => makeLine(n, m, p))
    const target = lines[index]
    const replacing = !(target.nom || target.minutes || target.prix)
    if (lines.length + added.length - Number(replacing) > 200) {
      setPasteError('Maximum 200 lignes par lot.')
      return
    }
    setLines([
      ...lines.slice(0, index),
      ...added,
      ...lines.slice(index + Number(replacing)),
    ])
    setPasteError('')
    setChecked(true)
  }
  const filled = lines.filter(
    (l) => l.nom.trim() || l.minutes.trim() || l.prix.trim(),
  )
  const known = new Set(
    services
      .filter(
        (s) =>
          normalize(s.categorie) === normalize(category) &&
          normalize(s.sous_categorie) === normalize(sub),
      )
      .map((s) => normalize(s.nom)),
  )
  function issue(line: Line) {
    const { minutes, centimes } = amounts(line),
      name = normalize(line.nom)
    if (!name || line.nom.trim().length > 120)
      return 'Renseignez un nom de 1 à 120 caractères.'
    if (
      known.has(name) ||
      filled.some((l) => l.id !== line.id && normalize(l.nom) === name)
    )
      return 'Ce nom existe déjà dans cette catégorie.'
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1200)
      return 'Durée attendue entre 1 et 1 200 minutes.'
    if (!Number.isInteger(centimes) || centimes < 0 || centimes > 10000000)
      return 'Prix attendu entre 0 et 100 000 €, avec deux décimales au maximum.'
    return ''
  }
  return (
    <Dialog title="Ajouter plusieurs prestations" close={close}>
      <p>
        Collez trois colonnes depuis votre tableur ou remplissez les lignes.
        Indiquez la durée du soin, sans la marge.
      </p>
      <Form
        label={
          'Créer ' +
          filled.length +
          (filled.length === 1 ? ' prestation' : ' prestations')
        }
        submit={async () => {
          setChecked(true)
          if (!filled.length || filled.some((l) => issue(l)))
            throw Error('Vérifiez les lignes avant de créer les prestations.')
          await rpc('importer_soins', {
            i,
            operation,
            visible,
            lignes: filled.map((l) => ({
              nom: l.nom.trim(),
              categorie: category.trim(),
              sous_categorie: sub.trim(),
              ...amounts(l),
            })),
          })
          await finish()
        }}
      >
        <label>
          Catégorie du lot
          <input
            maxLength={80}
            list="bulk-categories"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setSub('')
            }}
          />
        </label>
        <datalist id="bulk-categories">
          {[...new Set(services.map((s) => s.categorie).filter(Boolean))].map(
            (c) => (
              <option key={c} value={c} />
            ),
          )}
        </datalist>
        {category.trim() && (
          <label>
            Sous-catégorie du lot
            <input
              list="bulk-sub"
              maxLength={80}
              value={sub}
              onChange={(e) => setSub(e.target.value)}
            />
          </label>
        )}
        <datalist id="bulk-sub">
          {[
            ...new Set(
              services
                .filter((s) => s.categorie === category && s.sous_categorie)
                .map((s) => s.sous_categorie),
            ),
          ].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div ref={container}>
          {lines.map((line, index) => (
            <div className="bulk-line" key={line.id}>
              {(
                [
                  ['nom', 'Nom'],
                  ['minutes', 'Durée (min)'],
                  ['prix', 'Prix (€)'],
                ] as const
              ).map(([key, title]) => (
                <label key={key}>
                  {title}
                  <input
                    aria-label={title + ' · ligne ' + (index + 1)}
                    data-row={key === 'nom' ? line.id : undefined}
                    inputMode={
                      key === 'nom'
                        ? 'text'
                        : key === 'minutes'
                          ? 'numeric'
                          : 'decimal'
                    }
                    value={line[key]}
                    onPaste={(e) => paste(e, index)}
                    onChange={(e) => {
                      setPasteError('')
                      setLines(
                        lines.map((l) =>
                          l.id === line.id
                            ? { ...l, [key]: e.target.value }
                            : l,
                        ),
                      )
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (index === lines.length - 1) add()
                        else focus(lines[index + 1].id)
                      }
                    }}
                  />
                </label>
              ))}
              <button
                type="button"
                aria-label={'Retirer la ligne ' + (index + 1)}
                onClick={() =>
                  setLines(
                    lines.length === 1
                      ? [makeLine()]
                      : lines.filter((l) => l.id !== line.id),
                  )
                }
              >
                Retirer
              </button>
              {checked && filled.includes(line) && issue(line) && (
                <small className="error">{issue(line)}</small>
              )}
            </div>
          ))}
        </div>
        {pasteError && <p role="alert">{pasteError}</p>}
        <button type="button" disabled={lines.length >= 200} onClick={add}>
          Ajouter une ligne
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          Rendre ces prestations réservables en ligne
        </label>
      </Form>
    </Dialog>
  )
}

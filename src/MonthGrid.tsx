import { dayAdd, dayName, isoDay, today } from './data'

export function shiftMonth(month: string, offset: number) {
  const date = new Date(month + '-01T12:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}

export function MonthGrid({
  month,
  selected,
  pick,
  available,
  counts,
}: {
  month: string
  selected: string
  pick: (day: string) => void
  available?: Set<string>
  counts?: Map<string, number>
}) {
  const first = month + '-01'
  const next = shiftMonth(month, 1) + '-01'
  const length = Number(dayAdd(next, -1).slice(-2))
  return (
    <div className="month-grid">
      {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
        <small key={d}>{d}</small>
      ))}
      {Array.from({ length: length }, (_, i) => {
        const d = dayAdd(first, i),
          count = counts?.get(d) || 0
        return (
          <button
            type="button"
            key={d}
            style={i === 0 ? { gridColumnStart: isoDay(d) } : undefined}
            aria-label={
              dayName(d) +
              (available?.has(d) ? ' · créneau disponible' : '') +
              (count ? ' · ' + count + ' rendez-vous' : '')
            }
            aria-pressed={d === selected}
            className={d === today() ? 'current' : ''}
            onClick={() => pick(d)}
          >
            {i + 1}
            {count > 0 && <small>{count} RDV</small>}
            {available?.has(d) && <span className="availability-dot" />}
          </button>
        )
      })}
    </div>
  )
}

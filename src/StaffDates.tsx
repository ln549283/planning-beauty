import { useState, useEffect } from 'react'
import { rpc, dayAdd, dayName, hour, message } from './data'
import { MonthGrid, shiftMonth } from './MonthGrid'

export function StaffDates({
  institute,
  member,
  ids,
  value,
  change,
}: {
  institute: string
  member: string
  ids: string[]
  value: string
  change: (v: string) => void
}) {
  const month = value.slice(0, 7)
  const [available, setAvailable] = useState<string[]>([])
  const [slots, setSlots] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const day = value.slice(0, 10)
  const selection = ids.join(',')
  useEffect(() => {
    let live = true
    setError('')
    setAvailable([])
    setSlots([])
    setLoading(true)
    if (!selection || !month || !day) {
      setLoading(false)
      return
    }
    const args = { i: institute, p: member, ids: selection.split(',') }
    Promise.all([
      rpc<{ debut: string }[]>('creneaux_comptoir', {
        ...args,
        jour: month + '-01',
        jours: Number(dayAdd(shiftMonth(month, 1) + '-01', -1).slice(-2)),
      }),
      rpc<{ debut: string }[]>('creneaux_comptoir', {
        ...args,
        jour: day,
        jours: 1,
      }),
    ])
      .then(([days, times]) => {
        if (live) {
          setAvailable(days.map((x) => x.debut.slice(0, 10)))
          setSlots(times.map((x) => x.debut.slice(0, 16)))
        }
      })
      .catch((e) => {
        if (live) setError(message(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [institute, member, selection, month, day])
  return (
    <details open className="booking-dates">
      <summary>Choisir un créneau disponible</summary>
      <label>
        Mois et année
        <input
          type="month"
          value={month}
          onChange={(e) => {
            if (e.target.value) {
              change(e.target.value + '-01T09:00')
            }
          }}
        />
      </label>
      <MonthGrid
        month={month}
        selected={day}
        available={new Set(available)}
        pick={(d) => change(d + 'T' + (value.slice(11, 16) || '09:00'))}
      />
      <small>
        Le point indique qu’un créneau convient aux soins sélectionnés.
      </small>
      <label>
        {dayName(day)}
        <select
          aria-label="Horaires disponibles"
          value={slots.includes(value) ? value : ''}
          onChange={(e) => change(e.target.value)}
        >
          <option value="">
            {loading
              ? 'Recherche des créneaux…'
              : slots.length
                ? 'Choisir une heure'
                : 'Aucun créneau disponible'}
          </option>
          {slots.map((x) => (
            <option key={x} value={x}>
              {hour(x)}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </details>
  )
}

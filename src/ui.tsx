import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { message } from './data'
export function Brand() {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" />
      Planning beauté
    </div>
  )
}
export function Form({
  children,
  submit,
  label = 'Enregistrer',
  className = '',
}: {
  children?: ReactNode
  submit: (f: FormData) => Promise<unknown>
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const lock = useRef(false)
  return (
    <form
      className={'form ' + className}
      onSubmit={async (e) => {
        e.preventDefault()
        if (lock.current) return
        lock.current = true
        setBusy(true)
        setError('')
        const data = new FormData(e.currentTarget)
        try {
          await submit(data)
        } catch (err) {
          setError(message(err))
        } finally {
          lock.current = false
          setBusy(false)
        }
      }}
    >
      {children}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'En cours…' : label}
      </button>
    </form>
  )
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string
  children: ReactNode
  close: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog ref={ref} onCancel={close}>
      <header>
        <h2>{title}</h2>
        <button aria-label="Fermer" className="icon" onClick={close}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
export function Heading({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="heading">
      <h1>{title}</h1>
      <div className="actions">{children}</div>
    </div>
  )
}

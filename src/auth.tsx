import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

const passwordHint =
  '8 caractères minimum, avec au moins une majuscule, une minuscule, un chiffre et un symbole.'

export function newPassword(data: FormData) {
  const password = String(data.get('password') ?? '')
  if (
    Array.from(password).length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !Array.from(password).some((c) =>
      '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~'.includes(c),
    )
  ) {
    throw new Error(passwordHint)
  }
  if (password !== data.get('confirmation')) {
    throw new Error('Les deux mots de passe doivent être identiques.')
  }
  return password
}

export function PasswordFields({ creating }: { creating: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <>
      <div>
        <label htmlFor="password">Mot de passe</label>
        <div className="password">
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            required
            autoComplete={creating ? 'new-password' : 'current-password'}
            aria-describedby={creating ? 'password-hint' : undefined}
          />
          <button
            type="button"
            aria-label={
              show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
            }
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {creating && <small id="password-hint">{passwordHint}</small>}
      </div>
      {creating && (
        <label>
          Confirmer le mot de passe
          <input
            name="confirmation"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
          />
        </label>
      )}
    </>
  )
}

// Only the invitation is relevant after authentication. Never replay an expired
// callback, an OAuth code or a booking management token in a new e-mail.
export function redirectAfterAuth() {
  const url = new URL('/', location.origin)
  const invitation = new URLSearchParams(location.search).get('invitation')
  if (invitation) url.searchParams.set('invitation', invitation)
  return url.href
}

export function callbackMessage() {
  const hash = new URLSearchParams(location.hash.slice(1))
  const query = new URLSearchParams(location.search)
  const code = hash.get('error_code') || query.get('error_code')
  const error = hash.get('error') || query.get('error')
  if (code === 'otp_expired')
    return 'Ce lien est expiré ou a déjà été utilisé. Vous pouvez vous connecter ou demander un nouveau lien.'
  if (error || code)
    return 'La connexion n’a pas abouti. Vous pouvez réessayer.'
  return ''
}

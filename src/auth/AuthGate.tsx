import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { currentAccount, signIn, signUp, type Account } from './session'
import { isConfigured } from '@/lib/supabase'
import './auth.css'

/**
 * Puerta de entrada de la app.
 *
 * La sesion se guarda y se refresca sola; solo vuelve a pedirse tras una semana
 * sin abrir Oruka. Si ya hay sesion guardada pero no hay red, se entra igual:
 * el trabajo local no depende de internet.
 */
export function AuthGate({ children }: { children: (account: Account) => ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [checking, setChecking] = useState(true)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setAccount(await currentAccount())
      } catch {
        // Sin red o sin configurar: se muestra el acceso.
      } finally {
        setChecking(false)
      }
    })()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      if (isSignUp) {
        const created = await signUp(email.trim(), password)
        if (created) setAccount(created)
        else setNote('Cuenta creada. Revisa tu correo si Supabase pide confirmarla.')
      } else {
        setAccount(await signIn(email.trim(), password))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (checking) return <div className="auth auth--checking">Comprobando sesión…</div>
  if (account) return <>{children(account)}</>

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={(e) => void submit(e)}>
        <h1 className="auth__brand">Oruka</h1>
        <p className="auth__hint">
          {isSignUp
            ? 'Crea una cuenta para tus ideas.'
            : 'Entra con tu cuenta. La sesión se queda guardada una semana.'}
        </p>

        {!isConfigured() && (
          <p className="auth__error">
            Faltan las credenciales de Supabase. Copia <code>.env.example</code> a{' '}
            <code>.env.local</code> y rellénalas.
          </p>
        )}

        <label className="auth__field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="auth__field">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
          />
        </label>

        {error && <p className="auth__error">{error}</p>}
        {note && <p className="auth__note">{note}</p>}

        <button className="auth__submit" type="submit" disabled={busy || !isConfigured()}>
          {busy ? 'Un momento…' : isSignUp ? 'Crear cuenta' : 'Entrar'}
        </button>

        <button
          className="auth__toggle"
          type="button"
          onClick={() => {
            setIsSignUp((v) => !v)
            setError(null)
            setNote(null)
          }}
        >
          {isSignUp ? 'Ya tengo cuenta' : 'Crear una cuenta'}
        </button>
      </form>
    </div>
  )
}

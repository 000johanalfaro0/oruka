import { useState, type FormEvent } from 'react'
import { getSupabase, isConfigured } from '@/lib/supabase'

/**
 * Entrar con la misma cuenta del escritorio.
 *
 * No hay registro aqui a proposito: una cuenta se crea en la app grande, donde
 * ya esta explicado. Este sitio solo abre lo que ya existe.
 */
export function Login({
  onEntrar,
  onUsarQr,
}: {
  onEntrar: () => void
  onUsarQr: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setOcupado(true)
    setError(null)
    try {
      const supabase = await getSupabase()
      const { error: fallo } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (fallo) throw new Error(fallo.message)
      onEntrar()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <form className="login" onSubmit={(e) => void enviar(e)}>
      <h1 className="login__brand">Oruka</h1>
      <p className="login__hint">Entra con la misma cuenta que usas en el ordenador.</p>

      {!isConfigured() && (
        <p className="error">Esta copia se construyó sin las credenciales de Supabase.</p>
      )}

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>

      <label className="field">
        <span>Contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button className="primary" type="submit" disabled={ocupado}>
        {ocupado ? 'Entrando…' : 'Entrar'}
      </button>

      <button type="button" className="secundario" onClick={onUsarQr}>
        Volver al código QR
      </button>
    </form>
  )
}

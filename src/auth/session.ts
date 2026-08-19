import { getSupabase } from '@/lib/supabase'
import { storeGet, storeRemove, storeSet } from '@/lib/store'

/** Una semana sin abrir Oruka y se vuelve a pedir acceso. */
export const MAX_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000

const LAST_ACTIVE = 'oruka.lastActive'

export interface Account {
  id: string
  email: string | null
}

/** Marca que la app se ha usado ahora. */
export async function touch(): Promise<void> {
  await storeSet(LAST_ACTIVE, String(Date.now()))
}

/** Si la sesion guardada ha caducado por no usarse. */
export async function isStale(): Promise<boolean> {
  const raw = await storeGet(LAST_ACTIVE)
  if (!raw) return false
  const last = Number(raw)
  if (!Number.isFinite(last)) return false
  return Date.now() - last > MAX_INACTIVITY_MS
}

/**
 * Recupera la cuenta activa.
 *
 * Si la sesion esta guardada pero no hay red, se entra igual: el trabajo local
 * no puede quedarse bloqueado por no tener internet.
 */
export async function currentAccount(): Promise<Account | null> {
  const supabase = await getSupabase()

  if (await isStale()) {
    await supabase.auth.signOut().catch(() => {})
    await storeRemove(LAST_ACTIVE)
    return null
  }

  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) return null

  await touch()
  return { id: user.id, email: user.email ?? null }
}

export async function signIn(email: string, password: string): Promise<Account> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  await touch()
  return { id: data.user.id, email: data.user.email ?? null }
}

export async function signUp(email: string, password: string): Promise<Account | null> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  if (!data.session) return null // Supabase pide confirmar el correo
  await touch()
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase()
  await supabase.auth.signOut()
  await storeRemove(LAST_ACTIVE)
}

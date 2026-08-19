import type { SupabaseClient } from '@supabase/supabase-js'
import { tauriStorage } from './store'

/**
 * Cliente de Supabase, creado una sola vez y bajo demanda.
 *
 * La libreria se importa de forma dinamica para que no entre en el arranque de
 * la app: solo se descarga cuando de verdad hace falta autenticar o leer ideas.
 */
let client: SupabaseClient | null = null
let loading: Promise<SupabaseClient> | null = null

export class SupabaseNotConfigured extends Error {
  constructor() {
    super(
      'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local.',
    )
  }
}

export function isConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export async function getSupabase(): Promise<SupabaseClient> {
  if (client) return client
  if (loading) return loading

  if (!isConfigured()) throw new SupabaseNotConfigured()

  loading = import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      {
        auth: {
          // La sesion se guarda y se refresca sola; la caducidad por
          // inactividad la lleva session.ts, no la libreria.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          // A disco, no al navegador. El `localStorage` va por origen web, y el
          // de Oruka no es el mismo en desarrollo que en la app instalada: la
          // sesion se quedaba en el lado equivocado y habia que entrar de nuevo.
          storage: tauriStorage,
        },
      },
    )
    return client
  })

  return loading
}

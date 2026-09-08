import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El cliente de Supabase del telefono.
 *
 * Es gemelo de `src/lib/supabase.ts` y a proposito: el del escritorio guarda la
 * sesion en un archivo a traves de Tauri, y en un navegador eso no existe.
 * Aqui se usa el almacen del propio navegador, que es lo que hay.
 *
 * La configuracion del movil cambia `@/lib/supabase` por este archivo, asi que
 * todo lo que el escritorio ya sabe hacer contra la nube —leer ideas, hablar
 * con el puente— funciona igual sin duplicar ni una consulta.
 */

let client: SupabaseClient | null = null
let loading: Promise<SupabaseClient> | null = null

export class SupabaseNotConfigured extends Error {
  constructor() {
    super('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.')
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
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    )
    return client
  })

  return loading
}

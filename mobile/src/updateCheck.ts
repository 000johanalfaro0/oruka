import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

/**
 * Revisa si hay una version mas nueva que esta.
 *
 * No se pregunta al `latest.json` de GitHub directamente: ese archivo no
 * trae los encabezados de CORS que un navegador exige para dejarlo leer
 * desde una pagina web -funciona con curl o con la app de escritorio (que no
 * es un navegador), pero un `fetch()` de aqui se cae en silencio siempre,
 * tenga la version que tenga el telefono. Se pregunta en cambio a la misma
 * base de datos que ya usa todo lo demas, que si acepta lecturas desde el
 * navegador. `scripts/publicar.mjs` deja escrita ahi la version en cada
 * publicacion.
 *
 * Android no deja instalar nada sin que la persona toque "Instalar" -eso no
 * se puede saltar viniendo de fuera de la tienda de Google, ni aqui ni en
 * ninguna app. Esto es lo mas cerca de automatico que se puede: revisar sola
 * y avisar; el toque final para instalar sigue siendo de quien usa el
 * telefono.
 */
export const APK_URL = 'https://github.com/000johanalfaro0/oruka/releases/latest/download/oruka.apk'

/** Compara "0.1.18" contra "0.1.17": true si la primera es mas nueva. */
function esMasNueva(candidata: string, actual: string): boolean {
  const a = candidata.split('.').map(Number)
  const b = actual.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export function useUpdateCheck(): { versionNueva: string | null } {
  const [versionNueva, setVersionNueva] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const supabase = await getSupabase()
        const { data, error } = await supabase
          .from('app_meta')
          .select('value')
          .eq('key', 'latest_version')
          .maybeSingle()
        if (error || !data) return
        if (vivo && esMasNueva(data.value, __APP_VERSION__)) {
          setVersionNueva(data.value)
        }
      } catch {
        // Sin red o sin sesion: no pasa nada, se revisa la proxima vez.
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  return { versionNueva }
}

import { useEffect, useState } from 'react'

/**
 * Revisa si hay una version mas nueva que esta, mirando la misma lista que ya
 * usa la app de escritorio para actualizarse sola.
 *
 * Android no deja instalar nada sin que la persona toque "Instalar" -eso no
 * se puede saltar viniendo de fuera de la tienda de Google, ni aqui ni en
 * ninguna app. Esto es lo mas cerca de automatico que se puede: revisar sola
 * y avisar; el toque final para instalar sigue siendo de quien usa el
 * telefono.
 */
const MANIFEST_URL =
  'https://github.com/000johanalfaro0/oruka/releases/latest/download/latest.json'
export const APK_URL = 'https://github.com/000johanalfaro0/oruka/releases/latest/download/oruka.apk'

interface Manifest {
  version: string
}

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
        const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
        if (!res.ok) return
        const manifest = (await res.json()) as Manifest
        if (vivo && esMasNueva(manifest.version, __APP_VERSION__)) {
          setVersionNueva(manifest.version)
        }
      } catch {
        // Sin red o sin GitHub a mano: no pasa nada, se revisa la proxima vez.
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  return { versionNueva }
}

import { useEffect, useState } from 'react'
import { Shell } from '@/shell/Shell'
import { AuthGate } from '@/auth/AuthGate'
import { QuickSetup, isSetupDone } from '@/setup/QuickSetup'
import { migrateFromBrowser } from '@/lib/store'

/**
 * Arranque de la app.
 *
 * Lo primero de todo es la mudanza: hasta ahora la sesion, el setup y las
 * carpetas vivian en `localStorage`, que va por origen web, asi que la app
 * instalada no veia nada de lo hecho en la de desarrollo. Ahora todo eso vive
 * en disco, y este paso rescata lo que quedara en el navegador. Tiene que ir
 * **antes** de mirar si el setup esta hecho, o se veria vacio y saldria el
 * Quick Setup otra vez.
 */
export default function App() {
  const [setupDone, setSetupDone] = useState<boolean | null>(null)

  useEffect(() => {
    void migrateFromBrowser()
      .then(isSetupDone)
      .then(setSetupDone)
      // Si el disco no contesta, se sigue como si fuera la primera vez: es
      // recuperable desde Ajustes, y peor seria quedarse en negro.
      .catch(() => setSetupDone(false))
  }, [])

  // Mientras se lee el disco no se pinta nada: ensenar el Quick Setup y que
  // desapareciera medio segundo despues es peor que un instante en blanco.
  if (setupDone === null) return null

  // Primero identidad, luego configuracion, luego la app.
  return (
    <AuthGate>
      {() => (setupDone ? <Shell /> : <QuickSetup onDone={() => setSetupDone(true)} />)}
    </AuthGate>
  )
}

import { Suspense, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { activeModules } from './moduleRegistry'
import { useShellStore } from './shellStore'
import './StatusBar.css'

/**
 * Barra de estado. Cada modulo puede aportar su trozo; el shell solo reserva el
 * sitio y los pinta en orden de registro.
 */
export function StatusBar() {
  const activeId = useShellStore((s) => s.activeModuleId)
  /**
   * Que version es esta.
   *
   * Estaba en el backend desde el principio y el front no la pedia nunca, asi
   * que no habia forma de saber que tienes instalado sin ir a mirar el
   * instalador. Eso convierte cualquier duda sobre una actualizacion en una
   * adivinanza.
   */
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    void invoke<string>('app_version').then(setVersion).catch(() => {})
  }, [])

  return (
    <footer className="statusbar">
      {activeModules.map((m) => {
        const Slot = m.statusBar
        if (!Slot) return null
        return (
          <Suspense key={m.id} fallback={null}>
            <Slot />
          </Suspense>
        )
      })}
      <div className="statusbar__spacer" />
      <span className="statusbar__item">{activeId}</span>
      {version && <span className="statusbar__item statusbar__version">v{version}</span>}
    </footer>
  )
}

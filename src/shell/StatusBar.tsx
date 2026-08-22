import { Suspense } from 'react'
import { UpdateNotice } from './UpdateNotice'
import { activeModules } from './moduleRegistry'
import { useShellStore } from './shellStore'
import './StatusBar.css'

/**
 * Barra de estado. Cada modulo puede aportar su trozo; el shell solo reserva el
 * sitio y los pinta en orden de registro.
 */
export function StatusBar() {
  const activeId = useShellStore((s) => s.activeModuleId)

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
      {/* Version y aviso de actualizacion, justo al lado del nombre del
          modulo: es donde la vista ya va a buscar el estado de la app. */}
      <UpdateNotice />
    </footer>
  )
}

import { Suspense, useEffect } from 'react'
import { ModuleBar } from './ModuleBar'
import { StatusBar } from './StatusBar'
import { UpdateNotice } from './UpdateNotice'
import { findModule } from './moduleRegistry'
import { useShellStore } from './shellStore'
import { bus } from './bus'
import './Shell.css'

/**
 * Cascaron de la aplicacion: barra de modulos arriba, pestanas del modulo
 * activo debajo, la vista en medio y la barra de estado al fondo.
 *
 * No conoce ningun modulo por su nombre. Todo lo que pinta sale del contrato.
 */
export function Shell() {
  const activeId = useShellStore((s) => s.activeModuleId)
  const setActive = useShellStore((s) => s.setActiveModule)
  const active = findModule(activeId)

  // Otros modulos pueden pedir el foco sin importar el shell.
  useEffect(() => bus.on('shell.activateModule', ({ moduleId }) => setActive(moduleId)), [setActive])

  if (!active) {
    return <div className="shell__empty">No hay ningún módulo activo.</div>
  }

  const View = active.view
  const Tabs = active.tabs

  return (
    <div className="shell">
      <ModuleBar />
      {Tabs && (
        <Suspense fallback={<div className="shell__tabs-placeholder" />}>
          <Tabs />
        </Suspense>
      )}
      <main className="shell__view">
        <Suspense fallback={<div className="shell__loading">Cargando {active.label}...</div>}>
          <View />
        </Suspense>
      </main>
      <StatusBar />
      {/* Flota encima de todo: el aviso de version nueva no depende de en que
          modulo estes, y aparecer no puede mover tu trabajo de sitio. */}
      <UpdateNotice />
    </div>
  )
}

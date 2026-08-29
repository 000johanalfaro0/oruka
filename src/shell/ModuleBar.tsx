import type { OrukaModule } from '@/types/module'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { activeModules } from './moduleRegistry'
import { useShellStore } from './shellStore'
import { WindowControls } from './WindowControls'
import './ModuleBar.css'

/**
 * Barra superior de modulos y controles de ventana. Se construye desde el
 * registro y maneja el arrastre de la ventana en Tauri.
 */
export function ModuleBar() {
  const activeId = useShellStore((s) => s.activeModuleId)
  const setActive = useShellStore((s) => s.setActiveModule)

  const left = activeModules.filter((m) => (m.align ?? 'left') === 'left')
  const right = activeModules.filter((m) => m.align === 'right')

  const handleStartDrag = (e: React.MouseEvent) => {
    // Si no es clic izquierdo o se hizo sobre un botón/pestaña, no arrastra
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, [role="tab"]')) {
      void getCurrentWindow().startDragging()
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, [role="tab"]')) {
      void getCurrentWindow().toggleMaximize()
    }
  }

  const item = (m: OrukaModule) => (
    <button
      key={m.id}
      role="tab"
      aria-selected={m.id === activeId}
      className={`modulebar__item${m.id === activeId ? ' is-active' : ''}`}
      onClick={() => setActive(m.id)}
      title={m.label}
    >
      <i className={`codicon codicon-${m.icon}`} aria-hidden="true" />
      {!m.iconOnly && <span className="modulebar__label">{m.label}</span>}
    </button>
  )

  return (
    <header
      className="modulebar"
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      onDoubleClick={handleDoubleClick}
      role="tablist"
      aria-label="Módulos"
    >
      <span className="modulebar__brand" data-tauri-drag-region>
        Oruka
      </span>
      <div className="modulebar__group">{left.map(item)}</div>
      <div className="modulebar__spacer" data-tauri-drag-region />
      <div className="modulebar__group">{right.map(item)}</div>
      <WindowControls />
    </header>
  )
}

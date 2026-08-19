import type { OrukaModule } from '@/types/module'
import { activeModules } from './moduleRegistry'
import { useShellStore } from './shellStore'
import './ModuleBar.css'

/**
 * Barra superior de modulos. Se construye desde el registro, no desde una lista
 * escrita a mano: si manana hay un modulo mas, aparece solo.
 */
export function ModuleBar() {
  const activeId = useShellStore((s) => s.activeModuleId)
  const setActive = useShellStore((s) => s.setActiveModule)

  const left = activeModules.filter((m) => (m.align ?? 'left') === 'left')
  const right = activeModules.filter((m) => m.align === 'right')

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
    <nav className="modulebar" role="tablist" aria-label="Módulos">
      <span className="modulebar__brand">Oruka</span>
      {left.map(item)}
      <div className="modulebar__spacer" />
      {right.map(item)}
    </nav>
  )
}

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import './context-menu.css'

export interface MenuItem {
  /** Separador si no hay etiqueta. */
  label?: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  action?: () => void
  /** Submenu, para cosas como elegir CLI y modo. */
  items?: MenuItem[]
}

interface Position {
  x: number
  y: number
  items: MenuItem[]
}

/**
 * Menu contextual reutilizable.
 *
 * Vive fuera de `modules/` porque lo usan varias superficies. Se cierra al
 * hacer clic fuera, con Escape o al elegir algo.
 */
export function useContextMenu() {
  const [pos, setPos] = useState<Position | null>(null)

  const open = useCallback((e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY, items })
  }, [])

  const close = useCallback(() => setPos(null), [])

  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onClick = () => close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    window.addEventListener('contextmenu', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
      window.removeEventListener('contextmenu', onClick)
    }
  }, [pos, close])

  const menu: ReactNode = pos ? (
    <Menu x={pos.x} y={pos.y} items={pos.items} onPick={close} />
  ) : null

  return { open, menu }
}

function Menu({
  x,
  y,
  items,
  onPick,
}: {
  x: number
  y: number
  items: MenuItem[]
  onPick: () => void
}) {
  // Se ajusta para no salirse por el borde de la ventana.
  const left = Math.min(x, window.innerWidth - 230)
  const top = Math.min(y, window.innerHeight - items.length * 26 - 16)

  return (
    <ul
      className="ctx"
      style={{ left, top }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        !item.label ? (
          <li key={`sep-${i}`} className="ctx__sep" role="separator" />
        ) : item.items ? (
          <li key={item.label} className="ctx__item ctx__item--sub" role="menuitem">
            <i className={`codicon codicon-${item.icon ?? 'blank'}`} aria-hidden="true" />
            <span className="ctx__label">{item.label}</span>
            <i className="codicon codicon-chevron-right ctx__chev" aria-hidden="true" />
            <ul className="ctx ctx--nested">
              {item.items.map((sub) => (
                <li
                  key={sub.label}
                  className={`ctx__item${sub.disabled ? ' is-disabled' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    if (sub.disabled) return
                    sub.action?.()
                    onPick()
                  }}
                >
                  <i className={`codicon codicon-${sub.icon ?? 'blank'}`} aria-hidden="true" />
                  <span className="ctx__label">{sub.label}</span>
                </li>
              ))}
              {item.items.length === 0 && <li className="ctx__empty">nada disponible</li>}
            </ul>
          </li>
        ) : (
          <li
            key={item.label}
            className={`ctx__item${item.danger ? ' is-danger' : ''}${item.disabled ? ' is-disabled' : ''}`}
            role="menuitem"
            onClick={() => {
              if (item.disabled) return
              item.action?.()
              onPick()
            }}
          >
            <i className={`codicon codicon-${item.icon ?? 'blank'}`} aria-hidden="true" />
            <span className="ctx__label">{item.label}</span>
          </li>
        ),
      )}
    </ul>
  )
}

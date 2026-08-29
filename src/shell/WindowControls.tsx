import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './WindowControls.css'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)
  const appWindow = getCurrentWindow()

  useEffect(() => {
    let unlisten: (() => void) | undefined
    appWindow.isMaximized().then(setIsMaximized).catch(() => {})
    appWindow.onResized(async () => {
      try {
        const max = await appWindow.isMaximized()
        setIsMaximized(max)
      } catch {
        // Ignorar si el estado no está disponible
      }
    }).then((u) => {
      unlisten = u
    }).catch(() => {})

    return () => {
      unlisten?.()
    }
  }, [appWindow])

  const handleMinimize = () => {
    void appWindow.minimize()
  }

  const handleToggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize()
      const max = await appWindow.isMaximized()
      setIsMaximized(max)
    } catch {
      // Ignorar si falla la alternancia de maximizado
    }
  }

  const handleClose = () => {
    void appWindow.close()
  }

  return (
    <div className="win-controls" aria-label="Controles de ventana">
      <button
        type="button"
        className="win-controls__btn win-controls__btn--minimize"
        onClick={handleMinimize}
        title="Minimizar"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1.5 5.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="win-controls__btn win-controls__btn--maximize"
        onClick={handleToggleMaximize}
        title={isMaximized ? 'Restaurar' : 'Maximizar'}
      >
        {isMaximized ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M3.5 1.5h6v6h-1.5v-4.5h-4.5v-1.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <rect x="1.5" y="3.5" width="6" height="6" stroke="currentColor" strokeWidth="1" rx="0.5" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="1.5" y="1.5" width="8" height="8" stroke="currentColor" strokeWidth="1.1" rx="0.5" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-controls__btn win-controls__btn--close"
        onClick={handleClose}
        title="Cerrar"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M2 2l7 7M9 2l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

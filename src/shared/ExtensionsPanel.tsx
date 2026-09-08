import { useEffect, useState } from 'react'
import { detectClis, openExtensionStore, type DetectedCli } from '@/lib/agents'
import './extensions-panel.css'

/**
 * Extensiones de navegador oficiales, una por CLI que tenga una.
 *
 * Vive junto a la matriz MCP porque es la misma idea: darle al agente acceso
 * a algo fuera de la terminal. Alternativa a Browser Harness cuando no hace
 * falta automatizar nada -solo dejar que el propio CLI use el navegador de
 * siempre del usuario.
 */
export function ExtensionsPanel() {
  const [clis, setClis] = useState<DetectedCli[] | null>(null)

  useEffect(() => {
    detectClis().then(setClis).catch(() => setClis([]))
  }, [])

  const conExtension = clis?.filter((c) => c.browser_extension) ?? []

  return (
    <div className="ext-panel">
      <h3 className="ext-panel__title">Extensiones de navegador</h3>
      <p className="ext-panel__hint">
        Alternativa a Browser Harness: el propio CLI usa tu navegador de siempre. Ningún programa
        puede instalarlas solo -el navegador lo bloquea a propósito.
      </p>

      {clis === null && <p className="settings__pending">Comprobando…</p>}

      <ul className="ext-panel__list">
        {conExtension.map((c) => {
          const ext = c.browser_extension!
          return (
            <li key={c.id} className="ext-panel__item">
              <i
                className={`codicon codicon-${ext.installed ? 'pass-filled' : 'circle-large-outline'}`}
                aria-hidden="true"
              />
              <div className="ext-panel__text">
                <span className="ext-panel__name">{ext.name}</span>
                <span className="ext-panel__cli">{c.name}</span>
              </div>
              {ext.installed ? (
                <span className="ext-panel__status">en {ext.installed_in}</span>
              ) : (
                <button
                  className="ext-panel__open"
                  onClick={() => void openExtensionStore(ext.chrome_store_url)}
                >
                  Abrir tienda
                </button>
              )}
            </li>
          )
        })}
        {clis && conExtension.length === 0 && (
          <li className="ext-panel__empty">Ninguno de tus CLIs tiene extensión oficial.</li>
        )}
      </ul>
    </div>
  )
}

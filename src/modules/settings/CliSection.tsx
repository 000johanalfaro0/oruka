import { useEffect, useState } from 'react'
import { detectClis, type DetectedCli } from '@/lib/agents'

/**
 * CLIs detectados en este sistema.
 *
 * Llama directamente al puente compartido, no al modulo Workspace: Ajustes y
 * Workspace no se conocen entre si.
 */
export function CliSection() {
  const [clis, setClis] = useState<DetectedCli[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    setClis(null)
    detectClis().then(setClis).catch((e) => setError(String(e)))
  }

  useEffect(refresh, [])

  return (
    <section>
      <div className="settings__head">
        <h2 className="settings__title">CLIs de IA</h2>
        <button className="settings__refresh" onClick={refresh} title="Volver a detectar">
          <i className="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>
      <p className="settings__hint">
        Detectados en el PATH. Los que no aparecen simplemente no están instalados; Oruka
        funciona con los que haya.
      </p>

      {error && <p className="settings__error">{error}</p>}
      {!clis && !error && <p className="settings__pending">Detectando…</p>}

      <ul className="cli-list">
        {clis?.map((cli) => (
          <li key={cli.id} className={`cli${cli.found ? ' is-found' : ''}`}>
            <i
              className={`codicon codicon-${cli.found ? 'pass-filled' : 'circle-large-outline'}`}
              aria-hidden="true"
            />
            <span className="cli__name">{cli.name}</span>
            <span className="cli__version">{cli.version ?? ''}</span>
            <span className="cli__modes">
              {cli.modes.map((m) => (
                <span key={m} className="cli__mode">
                  {m}
                </span>
              ))}
            </span>
            <span className="cli__path" title={cli.path ?? ''}>
              {cli.path ?? 'no encontrado'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

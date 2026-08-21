import { useEffect, useState } from 'react'
import { detectClis, type DetectedCli } from '@/lib/agents'
import { loadConfig, resolveAgents, saveConfig, type RolesConfig } from '@/lib/roles'
import './roles-panel.css'

/**
 * Reparto de papeles entre los agentes.
 *
 * Vive fuera de `modules/` porque la usan dos superficies: el Quick Setup y
 * Ajustes. Igual que la matriz de MCP.
 *
 * Dos reglas de esta pantalla:
 *
 * 1. **Solo salen los CLIs instalados.** A quien no tenga codex no se le
 *    ofrece repartirle un papel a codex.
 * 2. **Viene apagado.** Estos archivos son del usuario y suelen estar
 *    versionados: que una app recien instalada te toque el `CLAUDE.md` del
 *    equipo sin preguntar es exactamente lo que no queremos.
 */
export function RolesPanel() {
  const [clis, setClis] = useState<DetectedCli[] | null>(null)
  const [config, setConfig] = useState<RolesConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [detected, saved] = await Promise.all([detectClis(), loadConfig()])
        setClis(detected)
        setConfig(saved)
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [])

  /** Guarda en el acto: no hay boton de aplicar, como en el resto del setup. */
  const update = (next: RolesConfig) => {
    setConfig(next)
    void saveConfig(next).catch((e) => setError(String(e)))
  }

  if (error) return <p className="roles__error">{error}</p>
  if (!clis || !config) return <p className="roles__pending">Buscando CLIs…</p>

  // Un CLI propio anadido por el usuario no trae rol en su manifiesto: no
  // sabemos que archivo lee, asi que no se le inventa uno.
  const elegibles = clis.filter((c) => c.found && c.role)
  const activos = resolveAgents(clis, config)
  const archivos = [...new Set(activos.map((a) => a.file))]

  if (elegibles.length === 0) {
    return (
      <p className="roles__pending">
        Ninguno de los CLIs detectados declara un rol. Esto se activará solo cuando tengas
        instalado alguno que lo soporte.
      </p>
    )
  }

  return (
    <div className="roles">
      <label className="roles__toggle">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update({ ...config, enabled: e.target.checked })}
        />
        <span>
          <strong>Escribir los roles al abrir un proyecto</strong>
          <small>
            Oruka mantiene un bloque delimitado dentro de esos archivos. Lo que esté fuera del
            bloque no se toca nunca, y se guarda una copia previa antes de escribir.
          </small>
        </span>
      </label>

      <ul className="roles__list">
        {elegibles.map((c) => {
          const spec = c.role!
          const mio = config.overrides[c.id]
          const fuera = config.off.includes(c.id)
          return (
            <li key={c.id} className={`roles__item${fuera ? ' is-off' : ''}`}>
              <label className="roles__who">
                <input
                  type="checkbox"
                  checked={!fuera}
                  disabled={!config.enabled}
                  onChange={(e) =>
                    update({
                      ...config,
                      off: e.target.checked
                        ? config.off.filter((id) => id !== c.id)
                        : [...config.off, c.id],
                    })
                  }
                />
                <span className="roles__name">{c.name}</span>
                <code className="roles__file">{spec.file}</code>
              </label>
              <input
                className="roles__role"
                value={mio?.role ?? spec.role}
                disabled={!config.enabled || fuera}
                aria-label={`Rol de ${c.name}`}
                onChange={(e) =>
                  update({
                    ...config,
                    overrides: {
                      ...config.overrides,
                      [c.id]: { role: e.target.value, brief: mio?.brief ?? spec.brief },
                    },
                  })
                }
              />
              <input
                className="roles__brief"
                value={mio?.brief ?? spec.brief}
                disabled={!config.enabled || fuera}
                aria-label={`Qué le toca a ${c.name}`}
                onChange={(e) =>
                  update({
                    ...config,
                    overrides: {
                      ...config.overrides,
                      [c.id]: { role: mio?.role ?? spec.role, brief: e.target.value },
                    },
                  })
                }
              />
            </li>
          )
        })}
      </ul>

      {config.enabled && activos.length > 0 && (
        <p className="roles__summary">
          Se escribirá en{' '}
          {archivos.map((f, i) => (
            <span key={f}>
              {i > 0 && ', '}
              <code>{f}</code>
            </span>
          ))}{' '}
          en la raíz de cada proyecto que abras.
          {archivos.length < activos.length &&
            ' Los que comparten archivo lo comparten de verdad: se escribe una sola vez, con la lista entera dentro.'}
        </p>
      )}
    </div>
  )
}

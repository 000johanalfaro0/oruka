import { useCallback, useEffect, useState } from 'react'
import { detectClis, type DetectedCli } from '@/lib/agents'
import {
  mcpApply,
  mcpCatalog,
  mcpPreview,
  mcpRevert,
  mcpState,
  mcpMissing,
  mcpInstallRequirement,
  type CliMcpState,
  type McpServer,
  type MissingRequirement,
} from '@/lib/mcp'
import './mcp-matrix.css'

interface Pending {
  cliId: string
  server: McpServer
  remove: boolean
  diff: string
}

/**
 * Matriz MCP x CLI.
 *
 * Vive fuera de `modules/` porque la usan dos superficies distintas: el paso 03
 * del Quick Setup y Ajustes. Ninguna de las dos sabe nada de la otra.
 *
 * Regla de la pantalla: nada se escribe sin que el usuario haya visto antes el
 * diff exacto sobre su propio archivo.
 */
export function McpMatrix() {
  const [catalog, setCatalog] = useState<McpServer[]>([])
  const [clis, setClis] = useState<DetectedCli[]>([])
  const [states, setStates] = useState<CliMcpState[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Servidores que no podrian arrancar en este equipo.
   *
   * Repartir uno al que le falta su programa base es peor que no ofrecerlo:
   * queda escrito en la configuracion del CLI y el usuario cree que lo tiene,
   * cuando en realidad falla en silencio al arrancar.
   */
  const [faltan, setFaltan] = useState<MissingRequirement[]>([])
  const [instalando, setInstalando] = useState<string | null>(null)

  const instalarBase = async (m: MissingRequirement) => {
    setInstalando(m.server_id)
    setError(null)
    try {
      await mcpInstallRequirement(m.server_id)
      setFaltan(await mcpMissing())
      setNote(m.name + ' instalado.')
    } catch (e) {
      setError(String(e).slice(-400))
    } finally {
      setInstalando(null)
    }
  }

  const refresh = useCallback(async (ids: string[]) => {
    setStates(await mcpState(ids))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [cat, detected, sinBase] = await Promise.all([
          mcpCatalog(),
          detectClis(),
          mcpMissing(),
        ])
        setFaltan(sinBase)
        const usable = detected.filter((c) => c.found)
        setCatalog(cat)
        setClis(usable)
        await refresh(usable.map((c) => c.id))
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [refresh])

  const stateOf = (cliId: string) => states.find((s) => s.cli_id === cliId)

  // El usuario puede tener servidores que no estan en nuestro catalogo. Si no
  // se listan, parece que Oruka los ha perdido. Se muestran como detectados:
  // se pueden quitar de donde estan, pero no anadir a otro CLI, porque no
  // conocemos su comando.
  const known = new Set(catalog.map((s) => s.id))
  const discovered = [...new Set(states.flatMap((s) => s.configured))]
    .filter((id) => !known.has(id))
    .sort()

  const ask = async (cliId: string, server: McpServer, remove: boolean) => {
    setError(null)
    try {
      const diff = await mcpPreview(cliId, server, remove)
      setPending({ cliId, server, remove, diff })
    } catch (e) {
      setError(String(e))
    }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const backup = await mcpApply(pending.cliId, pending.server, pending.remove)
      setNote(`Guardado. Copia previa: ${backup}`)
      await refresh(clis.map((c) => c.id))
      setPending(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const undo = async (cliId: string) => {
    setBusy(true)
    try {
      const restored = await mcpRevert(cliId)
      setNote(`Restaurado desde ${restored}`)
      await refresh(clis.map((c) => c.id))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && catalog.length === 0) return <p className="mcp__error">{error}</p>
  if (catalog.length === 0) return <p className="mcp__pending">Cargando catálogo…</p>

  return (
    <div className="mcp">
      <table className="mcp__table">
        <thead>
          <tr>
            <th className="mcp__corner">Servidor</th>
            {clis.map((c) => {
              const st = stateOf(c.id)
              return (
                <th key={c.id} className={st?.unsupported ? 'is-unsupported' : ''}>
                  <span title={st?.unsupported ?? st?.target ?? ''}>{c.name}</span>
                  {st?.unsupported && <span className="mcp__na">sin soporte</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {catalog.map((server) => (
            <tr key={server.id}>
              <th className="mcp__row-head">
                <span className="mcp__name">{server.name}</span>
                <span className="mcp__desc">{server.description}</span>
                {server.requiresEnv.length > 0 && (
                  <span className="mcp__env" title="Oruka escribe la referencia, nunca el valor">
                    necesita {server.requiresEnv.join(', ')}
                  </span>
                )}
              </th>
              {clis.map((c) => {
                const st = stateOf(c.id)
                const on = st?.configured.includes(server.id) ?? false
                return (
                  <td key={c.id}>
                    <button
                      className={`mcp__cell${on ? ' is-on' : ''}`}
                      disabled={!!st?.unsupported || busy}
                      title={
                        st?.unsupported ??
                        (on ? 'Quitar de este CLI' : 'Añadir a este CLI')
                      }
                      onClick={() => void ask(c.id, server, on)}
                    >
                      <i
                        className={`codicon codicon-${on ? 'check' : 'dash'}`}
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
          {discovered.map((id) => (
            <tr key={id} className="mcp__row-extra">
              <th className="mcp__row-head">
                <span className="mcp__name">{id}</span>
                <span className="mcp__desc">detectado, fuera del catálogo</span>
              </th>
              {clis.map((c) => {
                const st = stateOf(c.id)
                const on = st?.configured.includes(id) ?? false
                return (
                  <td key={c.id}>
                    <button
                      className={`mcp__cell${on ? ' is-on' : ''}`}
                      disabled={!on || busy}
                      title={
                        on
                          ? 'Quitar de este CLI'
                          : 'No está en el catálogo: Oruka no sabe su comando para añadirlo aquí'
                      }
                      onClick={() =>
                        void ask(c.id, { id, name: id, description: '', command: '', args: [], requiresEnv: [] }, true)
                      }
                    >
                      <i
                        className={`codicon codicon-${on ? 'check' : 'blank'}`}
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mcp__foot">
        {clis.map((c) => {
          const st = stateOf(c.id)
          if (!st?.has_backup) return null
          return (
            <button key={c.id} className="mcp__undo" disabled={busy} onClick={() => void undo(c.id)}>
              <i className="codicon codicon-discard" aria-hidden="true" />
              Revertir {c.name}
            </button>
          )
        })}
      </div>

      {/* Lo que no podria arrancar aunque se reparta. Va antes que el resto
          porque decide si repartirlo tiene sentido siquiera. */}
      {faltan.map((m) => (
        <div key={m.server_id} className="mcp__falta">
          <i className="codicon codicon-warning" aria-hidden="true" />
          <span>
            <strong>{catalog.find((c) => c.id === m.server_id)?.name ?? m.server_id}</strong> no
            arrancará: le falta <code>{m.name}</code> en este equipo.
          </span>
          {m.installable ? (
            <button
              className="mcp__falta-btn"
              disabled={instalando !== null}
              onClick={() => void instalarBase(m)}
            >
              {instalando === m.server_id ? 'Instalando…' : `Instalar ${m.name}`}
            </button>
          ) : (
            <a className="mcp__falta-btn" href={m.url} target="_blank" rel="noreferrer">
              Cómo instalarlo
            </a>
          )}
        </div>
      ))}
      {note && <p className="mcp__note">{note}</p>}
      {error && <p className="mcp__error">{error}</p>}

      {pending && (
        <div className="mcp__modal" role="dialog" aria-label="Confirmar cambio">
          <div className="mcp__modal-card">
            <h3 className="mcp__modal-title">
              {pending.remove ? 'Quitar' : 'Añadir'} {pending.server.name} en {pending.cliId}
            </h3>
            <p className="mcp__modal-path">{stateOf(pending.cliId)?.target}</p>
            <pre className="mcp__diff">{pending.diff}</pre>
            <div className="mcp__modal-actions">
              <button className="mcp__cancel" onClick={() => setPending(null)} disabled={busy}>
                Cancelar
              </button>
              <button className="mcp__confirm" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Guardando…' : 'Aplicar con copia de seguridad'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

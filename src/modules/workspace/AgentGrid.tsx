import { useState } from 'react'
import { useContextMenu, type MenuItem } from '@/shared/ContextMenu'
import { revealInExplorer } from '@/lib/agents'
import { AgentTerminal } from './AgentTerminal'
import { MAX_AGENTS, useWorkspaceStore, type OpenProject } from './workspaceStore'

/**
 * Rejilla de agentes del proyecto activo.
 *
 * El layout se deriva de cuantos agentes hay: 1 ocupa todo, 2 se parten, 3 y 4
 * hacen cuadricula. Layout y agente son cosas distintas, como pedia el diseno.
 */
export function AgentGrid({ project }: { project: OpenProject }) {
  const clis = useWorkspaceStore((s) => s.clis)
  const addAgent = useWorkspaceStore((s) => s.addAgent)
  const removeAgent = useWorkspaceStore((s) => s.removeAgent)
  const [picking, setPicking] = useState(false)
  const { open: openMenu, menu } = useContextMenu()

  const projectMenu = (): MenuItem[] => [
    {
      label: full ? `Nuevo agente (máximo ${MAX_AGENTS})` : 'Nuevo agente',
      icon: 'add',
      items: available.flatMap((c) =>
        c.modes.map((mode) => ({
          label: `${c.name} · ${mode}`,
          icon: 'terminal',
          disabled: full,
          action: () => addAgent(project.path, c.id, mode),
        })),
      ),
    },
    {},
    { label: 'Abrir en el explorador', icon: 'folder-opened', action: () => void revealInExplorer(project.path) },
    { label: 'Copiar ruta', icon: 'copy', action: () => void navigator.clipboard.writeText(project.path) },
  ]

  const agentMenu = (sessionId: string): MenuItem[] => [
    { label: 'Cerrar agente', icon: 'close', danger: true, action: () => void removeAgent(sessionId) },
    {},
    { label: 'Copiar ruta del proyecto', icon: 'copy', action: () => void navigator.clipboard.writeText(project.path) },
  ]

  const agents = project.agents
  const full = agents.length >= MAX_AGENTS
  const available = clis.filter((c) => c.found)

  return (
    <div className="grid-wrap" onContextMenu={(e) => openMenu(e, projectMenu())}>
      <div className="grid-bar">
        <span className="grid-bar__path" title={project.path}>
          {project.path}
        </span>
        <span className="grid-bar__count">
          {agents.length}/{MAX_AGENTS}
        </span>
        <div className="grid-bar__actions">
          <button
            className="grid-bar__add"
            onClick={() => setPicking((v) => !v)}
            disabled={full || available.length === 0}
            title={full ? `Maximo ${MAX_AGENTS} agentes por proyecto` : 'Añadir agente'}
          >
            <i className="codicon codicon-add" aria-hidden="true" />
            <span>Agente</span>
          </button>
          {picking && (
            <ul className="picker">
              {available.map((cli) => (
                <li key={cli.id} className="picker__group">
                  <span className="picker__name">{cli.name}</span>
                  <div className="picker__modes">
                    {cli.modes.map((mode) => (
                      <button
                        key={mode}
                        className="picker__mode"
                        onClick={() => {
                          addAgent(project.path, cli.id, mode)
                          setPicking(false)
                        }}
                        title={`${cli.name} en modo ${mode}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
              {available.length === 0 && (
                <li className="picker__empty">No se detecto ningun CLI</li>
              )}
            </ul>
          )}
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="grid-empty">
          <i className="codicon codicon-terminal" aria-hidden="true" />
          <p>Este proyecto no tiene agentes todavía.</p>
          <p className="grid-empty__hint">
            Pulsa <strong>Agente</strong> para lanzar uno en esta carpeta.
          </p>
        </div>
      ) : (
        <div className="grid" data-count={agents.length}>
          {agents.map((agent) => (
            <section key={agent.sessionId} className="panel">
              <header className="panel__head" onContextMenu={(e) => openMenu(e, agentMenu(agent.sessionId))}>
                <span className="panel__dot" />
                <span className="panel__title">{agent.cliName}</span>
                <span className="panel__mode">{agent.mode}</span>
                <button
                  className="panel__close"
                  onClick={() => void removeAgent(agent.sessionId)}
                  title="Cerrar agente"
                >
                  <i className="codicon codicon-close" aria-hidden="true" />
                </button>
              </header>
              <AgentTerminal
                sessionId={agent.sessionId}
                cliId={agent.cliId}
                cwd={project.path}
                mode={agent.mode}
                prompt={agent.prompt}
              />
            </section>
          ))}
        </div>
      )}
      {menu}
    </div>
  )
}

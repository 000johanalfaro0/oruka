import { useEffect, useState } from 'react'
import { githubBranchStatus, type BranchStatus } from '@/lib/github'
import { useWorkspaceStore } from './workspaceStore'
import './usage-bar.css'

/**
 * Barra de estado del módulo Workspace en el pie de la app.
 *
 * Muestra el proyecto activo, su rama Git y el estado real de los agentes
 * (trabajando, esperando o terminado) con indicadores en vivo.
 */
export function UsageBar() {
  const open = useWorkspaceStore((s) => s.open)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const actividad = useWorkspaceStore((s) => s.actividad)
  const remoteEnabled = useWorkspaceStore((s) => s.remoteEnabled)
  const remoteError = useWorkspaceStore((s) => s.remoteError)
  const toggleRemote = useWorkspaceStore((s) => s.toggleRemote)
  const [branchInfo, setBranchInfo] = useState<BranchStatus | null>(null)

  const activeProject = open.find((p) => p.path === activePath) || open[0]

  useEffect(() => {
    if (!activeProject?.path) {
      setBranchInfo(null)
      return
    }
    let cancel = false
    githubBranchStatus(activeProject.path)
      .then((status) => {
        if (!cancel) setBranchInfo(status)
      })
      .catch(() => {
        if (!cancel) setBranchInfo(null)
      })
    return () => {
      cancel = true
    }
  }, [activeProject?.path])

  /**
   * El aviso del mando a distancia.
   *
   * Se pinta esté donde esté el usuario y haya o no proyecto abierto: mientras
   * esto está encendido, un teléfono puede escribir en estos agentes, y eso no
   * puede quedar escondido detrás de una pestaña. Pulsarlo lo apaga.
   */
  const mando = remoteEnabled ? (
    <button
      type="button"
      className="workspace-status__remote"
      onClick={() => void toggleRemote(false)}
      title="Mando a distancia encendido: desde tu móvil se puede escribir en estos agentes. Pulsa para apagarlo."
    >
      <span className="workspace-status__remote-dot" aria-hidden="true" />
      <span>Móvil</span>
    </button>
  ) : remoteError ? (
    <span className="workspace-status__remote-error" title={remoteError}>
      <i className="codicon codicon-warning" aria-hidden="true" />
      <span>Móvil sin conectar</span>
    </span>
  ) : null

  if (!activeProject) {
    return mando ? <div className="workspace-status">{mando}</div> : null
  }

  return (
    <div className="workspace-status">
      {mando}
      {/* 1. Proyecto activo y rama Git */}
      <span className="workspace-status__project" title={`Ruta: ${activeProject.path}`}>
        <i className="codicon codicon-folder" aria-hidden="true" />
        <span>{activeProject.name}</span>
        {branchInfo && (
          <span className="workspace-status__git" title={`Rama: ${branchInfo.branch}`}>
            <i className="codicon codicon-git-branch" aria-hidden="true" />
            <span>{branchInfo.branch}</span>
          </span>
        )}
      </span>

      {/* 2. Agentes del proyecto en tiempo real */}
      {activeProject.agents.length > 0 && (
        <>
          <span className="workspace-status__divider">|</span>
          <div className="workspace-status__agents">
            {activeProject.agents.map((agent) => {
              const st = actividad[agent.sessionId] || 'esperando'
              const label =
                st === 'trabajando'
                  ? 'escribiendo'
                  : st === 'terminado'
                    ? 'detenido'
                    : 'listo'

              return (
                <span
                  key={agent.sessionId}
                  className={`agent-chip agent-chip--${st}`}
                  title={`${agent.cliName} · modo ${agent.mode} · ${label}`}
                >
                  <span className={`agent-chip__dot agent-chip__dot--${st}`} aria-hidden="true" />
                  <span className="agent-chip__name">{agent.cliName}</span>
                  <span className="agent-chip__mode">{agent.mode}</span>
                  <span className="agent-chip__status">{label}</span>
                </span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

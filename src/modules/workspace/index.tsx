import { useEffect } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useContextMenu } from '@/shared/ContextMenu'
import { revealInExplorer } from '@/lib/agents'
import { baseName } from '@/lib/paths'
import { bus } from '@/shell/bus'
import { AgentGrid } from './AgentGrid'
import { useWorkspaceStore } from './workspaceStore'
import './workspace.css'

/**
 * Modulo Workspace.
 *
 * El primer paso no es abrir un proyecto, es decirle a Oruka en que carpeta
 * trabaja. De esa raiz salen despues los proyectos que se abren en pestanas.
 *
 * Detalle importante: los proyectos abiertos se pintan TODOS a la vez y se
 * ocultan con CSS los que no estan activos. Si se desmontaran, sus terminales
 * moririan al cambiar de pestana, que es justo lo que no queremos.
 */
export default function WorkspaceModule() {
  const init = useWorkspaceStore((s) => s.init)
  const roots = useWorkspaceStore((s) => s.roots)
  const open = useWorkspaceStore((s) => s.open)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const addRoot = useWorkspaceStore((s) => s.addRoot)
  const openProject = useWorkspaceStore((s) => s.openProject)
  const removeRoot = useWorkspaceStore((s) => s.removeRoot)
  const error = useWorkspaceStore((s) => s.error)
  const { open: openMenu, menu } = useContextMenu()

  useEffect(() => {
    void init()
  }, [init])

  /**
   * Atiende a quien pide abrir un proyecto y lanzarle un agente.
   *
   * Es el unico sitio donde otro modulo puede hacer arrancar un agente, y solo
   * sabe pedirlo: que CLI, en que hueco y con que permisos se decide aqui. La
   * peticion puede haber llegado antes de que este modulo existiera en memoria,
   * asi que el bus la guarda y la entrega al suscribirse.
   */
  useEffect(
    () =>
      bus.on('workspace.openWithAgent', ({ projectPath, cli, prompt }) => {
        const { openProject: abrir, addAgent, clis } = useWorkspaceStore.getState()
        abrir(projectPath)
        // Sin CLI pedido, el primero que este de verdad instalado.
        const elegido = cli ?? clis.find((c) => c.found)?.id
        if (!elegido) return
        const modo = useWorkspaceStore.getState().clis.find((c) => c.id === elegido)?.modes[0] ?? ''
        addAgent(projectPath, elegido, modo, prompt)
      }),
    [],
  )

  const pickRoot = async () => {
    const picked = await openDialog({ directory: true, multiple: false })
    if (typeof picked === 'string') await addRoot(picked)
  }

  if (roots.length === 0) {
    return (
      <div className="ws-empty">
        <i className="codicon codicon-root-folder" aria-hidden="true" />
        <p className="ws-empty__text">Añade la carpeta donde Oruka va a trabajar.</p>
        <button className="ws-empty__action" onClick={() => void pickRoot()}>
          Añadir carpeta de trabajo
        </button>
        {error && <p className="ws-empty__error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="ws-stack">
      {/* Lista de carpetas de trabajo: visible cuando no hay pestana activa. */}
      <div className="ws-layer" hidden={activePath !== null}>
        <div className="ws-picker">
          <div className="ws-picker__head">
            <h2 className="ws-picker__title">Carpetas de trabajo</h2>
            <button className="ws-picker__addroot" onClick={() => void pickRoot()}>
              <i className="codicon codicon-add" aria-hidden="true" />
              <span>Abrir otra carpeta</span>
            </button>
          </div>
          <ul className="ws-picker__list">
            {roots.map((r) => (
              <li key={r}>
                <div
                  className="ws-picker__item"
                  onClick={() => openProject(r)}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      { label: 'Abrir', icon: 'go-to-file', action: () => openProject(r) },
                      {},
                      {
                        label: 'Abrir en el explorador',
                        icon: 'folder-opened',
                        action: () => void revealInExplorer(r),
                      },
                      {
                        label: 'Copiar ruta',
                        icon: 'copy',
                        action: () => void navigator.clipboard.writeText(r),
                      },
                      {},
                      {
                        label: 'Quitar de la lista',
                        icon: 'close',
                        danger: true,
                        action: () => void removeRoot(r),
                      },
                    ])
                  }
                  data-tip={r}
                >
                  <i className="codicon codicon-root-folder" aria-hidden="true" />
                  <div className="ws-picker__info">
                    <span className="ws-picker__name">{baseName(r)}</span>
                    <span className="ws-picker__path">{r}</span>
                  </div>
                  <button
                    type="button"
                    className="ws-picker__remove"
                    title="Quitar de la lista"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeRoot(r)
                    }}
                  >
                    <i className="codicon codicon-close" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
            {roots.length === 0 && (
              <li className="ws-picker__empty">
                No tienes carpetas de trabajo registradas. Pulsa en "Abrir otra carpeta" para comenzar.
              </li>
            )}
          </ul>
          {error && <p className="ws-picker__error">{error}</p>}
        </div>
      </div>

      {/* Un grid por proyecto abierto. Se ocultan, nunca se desmontan. */}
      {open.map((project) => (
        <div key={project.path} className="ws-layer" hidden={project.path !== activePath}>
          <AgentGrid project={project} />
        </div>
      ))}
      {menu}
    </div>
  )
}

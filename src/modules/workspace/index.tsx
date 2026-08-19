import { useEffect } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useContextMenu } from '@/shared/ContextMenu'
import { revealInExplorer } from '@/lib/agents'
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
  const projects = useWorkspaceStore((s) => s.discovered)
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
      {/* Lista de proyectos: visible cuando no hay pestana activa. */}
      <div className="ws-layer" hidden={activePath !== null}>
        <div className="ws-picker">
          <div className="ws-picker__head">
            <h2 className="ws-picker__title">Proyectos</h2>
            <button className="ws-picker__addroot" onClick={() => void pickRoot()}>
              <i className="codicon codicon-add" aria-hidden="true" />
              <span>Otra carpeta</span>
            </button>
          </div>
          <ul className="ws-picker__list">
            {projects.map((p) => (
              <li key={p.path}>
                <button
                  className="ws-picker__item"
                  onClick={() => openProject(p.path)}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      { label: 'Abrir', icon: 'go-to-file', action: () => openProject(p.path) },
                      {},
                      {
                        label: 'Abrir en el explorador',
                        icon: 'folder-opened',
                        action: () => void revealInExplorer(p.path),
                      },
                      {
                        label: 'Copiar ruta',
                        icon: 'copy',
                        action: () => void navigator.clipboard.writeText(p.path),
                      },
                    ])
                  }
                  title={p.path}
                >
                  <i
                    className={`codicon codicon-${p.is_git ? 'source-control' : 'folder'}`}
                    aria-hidden="true"
                  />
                  <span>{p.name}</span>
                </button>
              </li>
            ))}
            {projects.length === 0 && (
              <li className="ws-picker__empty">
                Esta carpeta no tiene subcarpetas. Puedes abrirla directamente como proyecto, o
                añadir otra raíz.
              </li>
            )}
          </ul>

          <div className="ws-roots">
            <span className="ws-roots__label">Carpetas de trabajo</span>
            {roots.map((r) => (
              <span key={r} className="ws-root">
                <button
                  className="ws-root__open"
                  onClick={() => openProject(r)}
                  title={`Abrir ${r} como proyecto`}
                >
                  <i className="codicon codicon-root-folder" aria-hidden="true" />
                  {r}
                </button>
                <span className="ws-root__count">
                  {projects.filter((p) => p.path.startsWith(r)).length}
                </span>
                <button
                  className="ws-root__remove"
                  title="Quitar esta carpeta"
                  onClick={() => void removeRoot(r)}
                >
                  <i className="codicon codicon-close" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
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

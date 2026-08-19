import { useContextMenu, type MenuItem } from '@/shared/ContextMenu'
import { revealInExplorer } from '@/lib/agents'
import { MAX_AGENTS, useWorkspaceStore, type OpenProject } from './workspaceStore'
import './workspace.css'

/** Pestanas de proyecto. Sin limite de proyectos; 4 agentes como mucho dentro de cada uno. */
export default function WorkspaceTabs() {
  const open = useWorkspaceStore((s) => s.open)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const close = useWorkspaceStore((s) => s.closeProject)
  const showList = useWorkspaceStore((s) => s.showProjectList)
  const clis = useWorkspaceStore((s) => s.clis)
  const addAgent = useWorkspaceStore((s) => s.addAgent)
  const { open: openMenu, menu } = useContextMenu()

  const menuFor = (p: OpenProject): MenuItem[] => {
    const full = p.agents.length >= MAX_AGENTS
    return [
      {
        label: full ? `Nuevo agente (máximo ${MAX_AGENTS})` : 'Nuevo agente',
        icon: 'add',
        items: clis
          .filter((c) => c.found)
          .flatMap((c) =>
            c.modes.map((mode) => ({
              label: `${c.name} · ${mode}`,
              icon: 'terminal',
              disabled: full,
              action: () => {
                setActive(p.path)
                addAgent(p.path, c.id, mode)
              },
            })),
          ),
      },
      {},
      { label: 'Abrir en el explorador', icon: 'folder-opened', action: () => void revealInExplorer(p.path) },
      { label: 'Copiar ruta', icon: 'copy', action: () => void navigator.clipboard.writeText(p.path) },
      {},
      { label: 'Cerrar', icon: 'close', danger: true, action: () => void close(p.path) },
      {
        label: 'Cerrar las demás',
        icon: 'clear-all',
        disabled: open.length < 2,
        action: () => {
          for (const other of open) if (other.path !== p.path) void close(other.path)
        },
      },
    ]
  }

  return (
    <div className="ws-tabs" role="tablist" aria-label="Proyectos abiertos">
      {open.map((p) => (
        <div
          key={p.path}
          role="tab"
          aria-selected={p.path === activePath}
          className={`ws-tab${p.path === activePath ? ' is-active' : ''}`}
          onClick={() => setActive(p.path)}
          onContextMenu={(e) => openMenu(e, menuFor(p))}
          onAuxClick={(e) => e.button === 1 && void close(p.path)}
          title={p.path}
        >
          <span className="ws-tab__name">{p.name}</span>
          {p.agents.length > 0 && (
            <span className="ws-tab__agents" title={`${p.agents.length} agente(s)`}>
              {p.agents.length}
            </span>
          )}
          <button
            className="ws-tab__close"
            onClick={(e) => {
              e.stopPropagation()
              void close(p.path)
            }}
            title="Cerrar proyecto"
          >
            <i className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button className="ws-tab__add" onClick={showList} title="Abrir otro proyecto">
        <i className="codicon codicon-add" aria-hidden="true" />
      </button>
      {menu}
    </div>
  )
}

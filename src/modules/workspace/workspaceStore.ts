import { create } from 'zustand'
import { bus } from '@/shell/bus'
import { baseName } from '@/lib/paths'
import { agentKill, detectClis, listProjects, type DetectedCli, type ProjectEntry } from '@/lib/agents'
import { storeGet, storeSet } from '@/lib/store'

/** Regla estructural: como mucho 4 agentes por proyecto. */
export const MAX_AGENTS = 4

export interface Agent {
  sessionId: string
  cliId: string
  cliName: string
  /** El modo de permisos con el que se lanzo. Se conserva al restaurar. */
  mode: string
  /** Prompt inicial, si el agente se lanzo desde Ideas. */
  prompt?: string
  /**
   * Viene de una sesion anterior de la app.
   *
   * El proceso murio al cerrar —eso no se puede evitar, es hijo de la app—,
   * pero la conversacion la guarda el propio CLI. Con esta marca se relanza
   * pidiendole que la retome en vez de empezar de cero.
   */
  restored?: boolean
}

export interface OpenProject {
  path: string
  name: string
  agents: Agent[]
}

interface WorkspaceState {
  roots: string[]
  discovered: ProjectEntry[]
  open: OpenProject[]
  activePath: string | null
  clis: DetectedCli[]
  initialised: boolean
  loading: boolean
  error: string | null

  init: () => Promise<void>
  addRoot: (path: string) => Promise<void>
  removeRoot: (path: string) => Promise<void>
  openProject: (path: string) => void
  closeProject: (path: string) => Promise<void>
  setActive: (path: string) => void
  showProjectList: () => void
  addAgent: (projectPath: string, cliId: string, mode: string, prompt?: string) => void
  removeAgent: (sessionId: string) => Promise<void>
}

/** Un mismo proyecto puede aparecer bajo dos raices: se queda una vez. */
function dedupe(list: ProjectEntry[]): ProjectEntry[] {
  const seen = new Map<string, ProjectEntry>()
  for (const p of list) seen.set(p.path, p)
  return [...seen.values()]
}

const STORAGE_KEY = 'oruka.workspace'

/** Lo que se guarda de un proyecto abierto, con sus agentes. */
interface PersistedProject {
  path: string
  agents: Array<Pick<Agent, 'sessionId' | 'cliId' | 'cliName' | 'mode'>>
}

interface Persisted {
  roots: string[]
  /**
   * Antes era `string[]` con solo las rutas. Se lee de las dos formas para no
   * dejar sin pestanas a quien ya tenia cosas guardadas.
   */
  open: Array<string | PersistedProject>
  activePath: string | null
}

/** Entiende el formato viejo y el nuevo. */
function readOpen(open: Persisted['open']): PersistedProject[] {
  return (open ?? []).map((item) =>
    typeof item === 'string' ? { path: item, agents: [] } : { path: item.path, agents: item.agents ?? [] },
  )
}

async function load(): Promise<Persisted> {
  try {
    const raw = await storeGet(STORAGE_KEY)
    if (!raw) return { roots: [], open: [], activePath: null }
    return JSON.parse(raw) as Persisted
  } catch {
    return { roots: [], open: [], activePath: null }
  }
}

/**
 * Guarda las carpetas y las pestanas abiertas.
 *
 * No se espera a que termine: guardar es un efecto de fondo, y bloquear la
 * interfaz por ello seria peor que perder el ultimo cambio si se corta la luz
 * justo en ese instante.
 */
function persist(state: WorkspaceState) {
  const data: Persisted = {
    roots: state.roots,
    // Los agentes se guardan con su modo: al volver, el que estaba en yolo
    // vuelve en yolo. Sin esto habia que reconfigurarlos uno a uno.
    open: state.open.map((p) => ({
      path: p.path,
      agents: p.agents.map(({ sessionId, cliId, cliName, mode }) => ({
        sessionId,
        cliId,
        cliName,
        mode,
      })),
    })),
    activePath: state.activePath,
  }
  void storeSet(STORAGE_KEY, JSON.stringify(data))
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  roots: [],
  initialised: false,
  discovered: [],
  open: [],
  activePath: null,
  clis: [],
  loading: false,
  error: null,

  /** Arranque: detecta CLIs y restaura carpetas y pestanas de la sesion anterior. */
  init: async () => {
    if (get().initialised) return
    set({ initialised: true })
    const saved = await load()
    set({ loading: true })
    try {
      const clis = await detectClis()
      // Los procesos no sobreviven al cierre —son hijos de la app—, pero si la
      // lista de agentes y su modo. Vuelven marcados como restaurados, y al
      // arrancar se les pide que retomen la conversacion en vez de empezar otra.
      const open = readOpen(saved.open).map((p) => ({
        path: p.path,
        name: baseName(p.path),
        agents: p.agents
          // Si un CLI ya no esta instalado, su agente no puede volver.
          .filter((a) => clis.some((c) => c.id === a.cliId && c.found))
          .map((a) => ({ ...a, restored: true })),
      }))
      set({
        clis,
        roots: saved.roots,
        open,
        activePath: saved.activePath ?? open[0]?.path ?? null,
      })
      // Se reconstruye la lista entera: acumular duplicaria los proyectos en
      // cada montaje del modulo.
      const all: ProjectEntry[] = []
      const problems: string[] = []
      for (const root of saved.roots) {
        try {
          all.push(...(await listProjects(root)))
        } catch (e) {
          // Tragarse esto dejaba una lista vacia sin explicacion.
          problems.push(`${root}: ${String(e)}`)
        }
      }
      set({ discovered: dedupe(all), error: problems.length ? problems.join(' | ') : null })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ loading: false })
    }
  },

  addRoot: async (path) => {
    if (get().roots.includes(path)) return
    set((s) => ({ roots: [...s.roots, path] }))
    try {
      const found = await listProjects(path)
      set((s) => ({ discovered: dedupe([...s.discovered, ...found]) }))
    } catch (e) {
      set({ error: String(e) })
    }
    persist(get())
  },

  removeRoot: async (path) => {
    set((s) => ({
      roots: s.roots.filter((r) => r !== path),
      discovered: s.discovered.filter((p) => !p.path.startsWith(path)),
    }))
    persist(get())
  },

  openProject: (path) => {
    const existing = get().open.find((p) => p.path === path)
    if (!existing) {
      set((s) => ({
        open: [...s.open, { path, name: baseName(path), agents: [] }],
        activePath: path,
      }))
    } else {
      set({ activePath: path })
    }
    persist(get())
    bus.emit('workspace.projectChanged', { projectPath: path })
  },

  closeProject: async (path) => {
    const project = get().open.find((p) => p.path === path)
    // Cerrar una pestana mata sus agentes: no dejamos procesos huerfanos.
    for (const agent of project?.agents ?? []) {
      await agentKill(agent.sessionId).catch(() => {})
    }
    const rest = get().open.filter((p) => p.path !== path)
    const active = get().activePath === path ? (rest.at(-1)?.path ?? null) : get().activePath
    set({ open: rest, activePath: active })
    persist(get())
    bus.emit('workspace.projectChanged', { projectPath: active })
  },

  /** Vuelve al listado sin cerrar ninguna pestana ni matar agentes. */
  showProjectList: () => {
    set({ activePath: null })
    persist(get())
    bus.emit('workspace.projectChanged', { projectPath: null })
  },

  setActive: (path) => {
    set({ activePath: path })
    persist(get())
    bus.emit('workspace.projectChanged', { projectPath: path })
  },

  addAgent: (projectPath, cliId, mode, prompt) => {
    const { open, clis } = get()
    const project = open.find((p) => p.path === projectPath)
    if (!project || project.agents.length >= MAX_AGENTS) return
    const cli = clis.find((c) => c.id === cliId)

    const agent: Agent = {
      sessionId: `${cliId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cliId,
      cliName: cli?.name ?? cliId,
      mode,
      prompt,
    }
    set((s) => ({
      open: s.open.map((p) =>
        p.path === projectPath ? { ...p, agents: [...p.agents, agent] } : p,
      ),
    }))
    // Sin esto, un agente lanzado y la app cerrada acto seguido no se recordaba.
    persist(get())
  },

  removeAgent: async (sessionId) => {
    await agentKill(sessionId).catch(() => {})
    set((s) => ({
      open: s.open.map((p) => ({
        ...p,
        agents: p.agents.filter((a) => a.sessionId !== sessionId),
      })),
    }))
    persist(get())
  },
}))

export const useActiveProject = () =>
  useWorkspaceStore((s) => s.open.find((p) => p.path === s.activePath) ?? null)

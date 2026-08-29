import { create } from 'zustand'
import { bus } from '@/shell/bus'
import { baseName } from '@/lib/paths'
import {
  agentKill,
  detectClis,
  listProjects,
  onAgentExit,
  onAgentOutput,
  onAgentTokens,
  type DetectedCli,
  type ProjectEntry,
} from '@/lib/agents'
import { storeGet, storeSet } from '@/lib/store'
import { syncProject } from '@/lib/roles'

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
   * Arranca retomando la conversacion anterior en vez de empezar una nueva.
   *
   * Se pone en dos casos: al restaurar sesiones tras cerrar la app, y cuando
   * eliges «continuar» al lanzar el agente a mano. El proceso no se puede
   * salvar —es hijo de la app— pero la conversacion la guarda el propio CLI.
   */
  resume?: boolean
}

export interface OpenProject {
  path: string
  name: string
  agents: Agent[]
}

/**
 * Lo que gasta cada CLI, no cada agente.
 *
 * La cuota es de la cuenta, no de la ventana: dos agy abiertos comparten el
 * mismo limite, asi que comparten cifra y comparten barra. Por eso va indexado
 * por CLI y no por sesion.
 */
type Gasto = Record<string, number>

/**
 * Quien esta escuchando el gasto de cada sesion.
 *
 * Vive FUERA de React a proposito. El shell desmonta el modulo que no esta
 * activo, asi que una suscripcion dentro de un componente se pierde al cambiar
 * de ventana y la barra del pie se quedaria congelada mirando a otro lado.
 */
const escuchas = new Map<string, Array<() => void>>()

/**
 * Que esta haciendo cada agente.
 *
 * Solo tres, y son los tres que se pueden saber de verdad mirando su salida.
 * «Inactivo» y «esperando» son indistinguibles desde fuera —un agente parado y
 * uno esperando tu respuesta callan igual—, asi que inventar esa diferencia
 * seria decirle al usuario algo que no sabemos.
 */
export type Actividad = 'trabajando' | 'esperando' | 'terminado'

/** Cuando escribio algo por ultima vez cada sesion. Fuera de React: cambia
 *  cientos de veces por segundo y no puede provocar un repintado cada vez. */
const ultimaSalida = new Map<string, number>()
const terminadas = new Set<string>()

/** Cuanto callar para dejar de considerarse «trabajando». */
const SILENCIO_MS = 1200

/** Empieza a escuchar el gasto de una sesion y lo guarda bajo su CLI. */
function escuchar(sessionId: string, cliId: string, set: (g: (p: Gasto) => Gasto) => void) {
  if (escuchas.has(sessionId)) return
  // Se marca ya para que dos llamadas seguidas no abran dos suscripciones.
  escuchas.set(sessionId, [])
  const guarda = (off: () => void) => escuchas.get(sessionId)?.push(off)

  void onAgentTokens(sessionId, (total) => {
    set((prev) => ({ ...prev, [cliId]: total }))
  }).then(guarda)

  // Solo se apunta la hora. Traducirlo a un estado y repintar lo hace el reloj
  // de abajo, una vez cada medio segundo, en vez de con cada trozo de texto.
  ultimaSalida.set(sessionId, Date.now())
  void onAgentOutput(sessionId, () => {
    ultimaSalida.set(sessionId, Date.now())
  }).then(guarda)

  void onAgentExit(sessionId, () => {
    terminadas.add(sessionId)
  }).then(guarda)
}

/** Deja de escuchar una sesion que ya no existe. */
function dejar(sessionId: string) {
  escuchas.get(sessionId)?.forEach((off) => off())
  escuchas.delete(sessionId)
  ultimaSalida.delete(sessionId)
  terminadas.delete(sessionId)
}

interface WorkspaceState {
  roots: string[]
  discovered: ProjectEntry[]
  open: OpenProject[]
  activePath: string | null
  clis: DetectedCli[]
  /** Lo que lleva gastado cada CLI, indexado por su id. */
  usage: Gasto
  /** Que esta haciendo cada agente, indexado por su id de sesion. */
  actividad: Record<string, Actividad>
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
  addAgent: (
    projectPath: string,
    cliId: string,
    mode: string,
    prompt?: string,
    resume?: boolean,
  ) => void
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
  usage: {},
  actividad: {},
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
          .map((a) => ({ ...a, resume: true })),
      }))
      const activePath = saved.activePath ?? open[0]?.path ?? null
      set({ clis, roots: saved.roots, open, activePath })
      // Restaurar una pestana tambien es cambiar de proyecto para quien
      // escuche. Sin esto, GitHub arrancaba creyendo que no hay ninguna
      // carpeta abierta y no lo descubria hasta que cambiabas de pestana a
      // mano.
      bus.emit('workspace.projectChanged', { projectPath: activePath })
      // Los agentes restaurados tambien gastan: sin esto, sus barras se
      // quedaban vacias hasta que cerrabas y abrias el agente a mano.
      for (const p of open) {
        for (const a of p.agents) {
          escuchar(a.sessionId, a.cliId, (f) => set((st) => ({ usage: f(st.usage) })))
        }
      }
      // Se reconstruye la lista entera: acumular duplicaria los proyectos en
      // cada montaje del modulo. Si una raiz ya no existe en disco, se omite
      // limpiamente sin ensuciar la interfaz con errores de sistema.
      const all: ProjectEntry[] = []
      for (const root of saved.roots) {
        try {
          all.push(...(await listProjects(root)))
        } catch {
          // Si una carpeta fue movida o borrada en disco, se ignora silenciosamente.
        }
      }
      set({ discovered: dedupe(all), error: null })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ loading: false })
    }
  },

  addRoot: async (path) => {
    if (get().roots.includes(path)) return
    set((s) => ({ roots: [...s.roots, path], error: null }))
    try {
      const found = await listProjects(path)
      set((s) => ({ discovered: dedupe([...s.discovered, ...found]), error: null }))
    } catch (e) {
      set({ error: `No se pudo leer la carpeta seleccionada: ${String(e)}` })
    }
    persist(get())
  },

  removeRoot: async (path) => {
    set((s) => ({
      roots: s.roots.filter((r) => r !== path),
      discovered: s.discovered.filter((p) => !p.path.startsWith(path)),
      error: null,
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
      // Reparto de roles al abrir la carpeta, si el usuario lo tiene activado.
      // No se espera a que termine: abrir una pestana no puede quedarse
      // colgada de una escritura a disco. Solo al abrirla por primera vez;
      // volver a una pestana ya abierta no reescribe nada.
      void syncProject(path, get().clis).catch((e) =>
        // Tragarse esto dejaria archivos sin escribir sin que nadie lo sepa.
        set({ error: `no se pudieron escribir los roles: ${String(e)}` }),
      )
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
      dejar(agent.sessionId)
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

  addAgent: (projectPath, cliId, mode, prompt, resume) => {
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
      resume,
    }
    set((s) => ({
      open: s.open.map((p) =>
        p.path === projectPath ? { ...p, agents: [...p.agents, agent] } : p,
      ),
    }))
    escuchar(agent.sessionId, cliId, (f) => set((st) => ({ usage: f(st.usage) })))
    // Sin esto, un agente lanzado y la app cerrada acto seguido no se recordaba.
    persist(get())
  },

  removeAgent: async (sessionId) => {
    await agentKill(sessionId).catch(() => {})
    dejar(sessionId)
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

/**
 * Traduce el silencio en estado, una vez cada medio segundo.
 *
 * Un solo reloj para toda la app, y **solo llama a `set` si algo cambio**: la
 * salida de un agente llega cientos de veces por segundo, y repintar con cada
 * trozo era justo lo que hacia ir lenta la interfaz en equipos modestos.
 */
setInterval(() => {
  const { open, actividad } = useWorkspaceStore.getState()
  const ahora = Date.now()
  const siguiente: Record<string, Actividad> = {}
  let cambio = false

  for (const proyecto of open) {
    for (const agente of proyecto.agents) {
      const id = agente.sessionId
      const estado: Actividad = terminadas.has(id)
        ? 'terminado'
        : ahora - (ultimaSalida.get(id) ?? 0) < SILENCIO_MS
          ? 'trabajando'
          : 'esperando'
      siguiente[id] = estado
      if (actividad[id] !== estado) cambio = true
    }
  }
  // Tambien cambia si desaparecio un agente que estaba en la lista.
  if (!cambio && Object.keys(actividad).length !== Object.keys(siguiente).length) cambio = true
  if (cambio) useWorkspaceStore.setState({ actividad: siguiente })
}, 500)

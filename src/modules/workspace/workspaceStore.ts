import { create } from 'zustand'
import { bus } from '@/shell/bus'
import { baseName } from '@/lib/paths'
import {
  agentKill,
  agentScrollback,
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
import { playFinishedSound } from '@/lib/notifications'
import { recordPreview, toPreview, touchSession } from '@/lib/sessions'
import type { RemoteSnapshot } from '@/lib/relay'
import { apagar, encender, estabaActivo, type BridgePort } from './remoteBridge'

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

/**
 * Desde cuando lleva "trabajando" cada sesion, sin cortes.
 *
 * Hace falta para el sonido de aviso: cambiar de pestana redimensiona la
 * terminal, y muchos CLIs repintan su pantalla entera al recibir ese cambio
 * de tamano -un parpadeo de salida que por si solo ya cuenta como
 * "trabajando" un instante. Sin este control, ese parpadeo se leia como un
 * "termino de trabajar" y sonaba con cada cambio de pestana.
 */
const trabajandoDesde = new Map<string, number>()
/** Por debajo de esto, un tramo de "trabajando" es ruido, no una tarea real. */
const MIN_TRABAJO_MS = 4000

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
  trabajandoDesde.delete(sessionId)
}

/**
 * Guarda el ultimo texto visible de una sesion antes de matarla.
 *
 * Es lo unico que le queda al panel de Sesiones despues de cerrar: el proceso
 * no sobrevive al cierre, esto si.
 */
async function guardarVistaPrevia(sessionId: string) {
  const foto = await agentScrollback(sessionId).catch(() => null)
  if (foto?.data) await recordPreview(sessionId, toPreview(foto.data))
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

  /**
   * El mando a distancia desde el movil.
   *
   * Viene apagado y se queda como lo dejaste. Encendido, cualquiera con tu
   * cuenta puede escribir en estos agentes desde un telefono, asi que la
   * interfaz tiene que enseñarlo mientras lo este.
   */
  remoteEnabled: boolean
  remoteError: string | null
  /** El id de este equipo en la nube. Null mientras el mando este apagado. */
  remoteHostId: string | null
  toggleRemote: (on: boolean) => Promise<void>
}

/** Un mismo proyecto puede aparecer bajo dos raices: se queda una vez. */
function dedupe(list: ProjectEntry[]): ProjectEntry[] {
  const seen = new Map<string, ProjectEntry>()
  for (const p of list) seen.set(p.path, p)
  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// Lo que ve el movil
// ---------------------------------------------------------------------------

/** La foto que se publica: proyectos, agentes y que esta haciendo cada uno. */
function snapshot(): RemoteSnapshot {
  const { open, discovered, activePath, actividad } = useWorkspaceStore.getState()
  return {
    version: 1,
    activePath,
    projects: open.map((p) => ({
      path: p.path,
      name: p.name,
      agents: p.agents.map((a) => ({
        sessionId: a.sessionId,
        cliId: a.cliId,
        cliName: a.cliName,
        actividad: actividad[a.sessionId] ?? 'esperando',
      })),
    })),
    // Lo que el movil puede pedir abrir: descubierto, pero no abierto ya.
    closedProjects: discovered
      .filter((d) => !open.some((p) => p.path === d.path))
      .map((d) => ({ path: d.path, name: d.name })),
  }
}

/**
 * Un resumen de la foto, para saber si de verdad cambio.
 *
 * El almacen avisa de CUALQUIER cambio, y el gasto de los agentes cambia
 * cientos de veces por minuto sin que el movil tenga nada nuevo que pintar.
 * Publicar en cada aviso seria una escritura constante contra la nube.
 */
function firma(foto: RemoteSnapshot): string {
  return (
    foto.activePath +
    '|' +
    foto.projects
      .map((p) => p.path + ':' + p.agents.map((a) => a.sessionId + a.actividad).join(','))
      .join(';') +
    '|' +
    foto.closedProjects.map((p) => p.path).join(',')
  )
}

/**
 * Cuenta por el bus como esta el mando.
 *
 * El interruptor vive en el modulo Movil, que no puede importar este archivo.
 * Va por el bus y como estado retenido: ese modulo se desmonta al mirar otra
 * cosa, y al volver tiene que saber si el mando esta puesto sin esperar a que
 * alguien lo cambie.
 */
function anunciarMando() {
  const { remoteEnabled, remoteHostId, remoteError } = useWorkspaceStore.getState()
  bus.emit('workspace.remoteState', {
    enabled: remoteEnabled,
    hostId: remoteHostId,
    error: remoteError,
  })
}

/** El enchufe que el puente usa para mirar aqui dentro sin importar nada. */
const puerto: BridgePort = {
  getSnapshot: snapshot,
  subscribe: (fn) => {
    let previa = firma(snapshot())
    return useWorkspaceStore.subscribe(() => {
      const ahora = firma(snapshot())
      if (ahora === previa) return
      previa = ahora
      fn()
    })
  },
  onError: (mensaje) => useWorkspaceStore.setState({ remoteError: mensaje }),
  openProject: (path) => useWorkspaceStore.getState().openProject(path),
  closeProject: (path) => void useWorkspaceStore.getState().closeProject(path),
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
  remoteEnabled: false,
  remoteError: null,
  remoteHostId: null,

  /**
   * Enciende o apaga el mando a distancia.
   *
   * Si encender falla, el interruptor se queda abajo. Dejarlo arriba con el
   * puente muerto es la peor version: el usuario creeria que su telefono manda
   * cuando no manda.
   */
  toggleRemote: async (on) => {
    set({ remoteError: null })
    try {
      if (on) {
        const hostId = await encender(puerto)
        set({ remoteEnabled: true, remoteHostId: hostId })
      } else {
        await apagar()
        set({ remoteEnabled: false, remoteHostId: null })
      }
    } catch (e) {
      set({ remoteEnabled: false, remoteHostId: null, remoteError: String(e) })
    }
    anunciarMando()
  },

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
      // El mando a distancia se queda como lo dejaste. Si no se puede levantar
      // —sin red, sin sesion— el interruptor se queda abajo y se dice por que:
      // un mando que se cree encendido y no lo esta es peor que uno apagado.
      if (await estabaActivo()) {
        try {
          const hostId = await encender(puerto)
          set({ remoteEnabled: true, remoteHostId: hostId })
        } catch (e) {
          set({ remoteEnabled: false, remoteHostId: null, remoteError: String(e) })
        }
      }
      // Se anuncia siempre, tambien apagado: el modulo Movil necesita saber
      // que esta apagado, no quedarse esperando una respuesta que no llega.
      anunciarMando()
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
      await guardarVistaPrevia(agent.sessionId)
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
    void touchSession({
      id: agent.sessionId,
      projectPath,
      projectName: project.name,
      cliId,
      cliName: agent.cliName,
      mode,
      lastActiveAt: Date.now(),
    })
  },

  removeAgent: async (sessionId) => {
    await guardarVistaPrevia(sessionId)
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
      if (actividad[id] !== estado) {
        cambio = true
        if (estado === 'trabajando') {
          // Empieza un tramo nuevo. Si ya venia de uno (parpadeo dentro del
          // mismo tramo) no se pisa el inicio real.
          if (!trabajandoDesde.has(id)) trabajandoDesde.set(id, ahora)
        } else if (actividad[id] === 'trabajando') {
          // Cruza de "trabajando" a lo que sea despues. Solo cuenta como
          // "termino de verdad" si el tramo duro lo suficiente: un cambio de
          // pestana redimensiona la terminal y el CLI repinta su pantalla,
          // lo que por si solo parece un parpadeo de "trabajando".
          const desde = trabajandoDesde.get(id) ?? ahora
          if (ahora - desde >= MIN_TRABAJO_MS) void playFinishedSound()
          trabajandoDesde.delete(id)
        }
      }
    }
  }
  // Tambien cambia si desaparecio un agente que estaba en la lista.
  if (!cambio && Object.keys(actividad).length !== Object.keys(siguiente).length) cambio = true
  if (cambio) useWorkspaceStore.setState({ actividad: siguiente })
}, 500)

/**
 * El interruptor del mando, accionado desde el modulo Movil.
 *
 * Se registra aqui, en el almacen, y no dentro de un componente: el shell
 * desmonta el modulo que no esta activo, y este archivo en cambio sigue en
 * memoria desde que la app arranca, porque la barra de estado lo trae.
 */
bus.on('workspace.setRemote', ({ on }) => {
  void useWorkspaceStore.getState().toggleRemote(on)
})

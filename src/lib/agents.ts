import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Un CLI de IA ya resuelto contra este sistema. */
export interface DetectedCli {
  id: string
  name: string
  icon: string
  found: boolean
  path: string | null
  version: string | null
  modes: string[]
  /**
   * Si sabe retomar una conversacion anterior.
   *
   * La interfaz no ofrece «continuar» a un CLI que no puede: un botón que
   * siempre falla es peor que no tener botón.
   */
  can_resume: boolean
  /**
   * Rol de fabrica que declara su manifiesto, si trae uno.
   *
   * Se escribe con la forma en crudo, y no importando RoleSpec de roles.ts,
   * para no cerrar un ciclo entre los dos modulos: roles.ts ya depende de
   * este.
   */
  role: { file: string; role: string; brief: string } | null
  /**
   * Como publica este CLI su propio gasto, si lo publica.
   *
   * No todos hablan de lo mismo: claude dice cuanto llevas de tu limite
   * semanal y codex cuanta memoria le queda a la conversacion. Por eso viene
   * la etiqueta y el sentido, y no se mezclan entre si.
   */
  usage: {
    marker: string
    number: 'before' | 'after'
    unit: 'percent' | 'tokens'
    label: string
    direction: 'used' | 'left'
  } | null
}

export interface ProjectEntry {
  name: string
  path: string
  is_git: boolean
}

export const detectClis = () => invoke<DetectedCli[]>('detect_clis')

export const listProjects = (root: string) => invoke<ProjectEntry[]>('list_projects', { root })

export const agentSpawn = (args: {
  id: string
  cliId: string
  cwd: string
  mode: string
  cols: number
  rows: number
  /** Prompt inicial. Corto: el texto largo va en un archivo aparte. */
  prompt?: string
  /**
   * Retomar la conversacion anterior en vez de empezar una nueva.
   *
   * Se usa al restaurar sesiones tras cerrar la app: el proceso murio, pero la
   * conversacion la guarda el propio CLI y sabe volver a ella.
   */
  resume?: boolean
}) => invoke<void>('agent_spawn', args)

export const agentWrite = (id: string, data: string) => invoke<void>('agent_write', { id, data })

export const agentResize = (id: string, cols: number, rows: number) =>
  invoke<void>('agent_resize', { id, cols, rows })

export const agentKill = (id: string) => invoke<void>('agent_kill', { id })

/** La salida reciente de una sesion viva, con el punto en el que se tomo. */
export interface Scrollback {
  data: string
  /** Bytes emitidos por la sesion hasta esta foto. */
  seq: number
}

/**
 * Pide la salida reciente de una sesion para repintarla.
 *
 * `null` si la sesion ya no esta viva.
 */
export const agentScrollback = (id: string) => invoke<Scrollback | null>('agent_scrollback', { id })

/**
 * Se suscribe a la salida de una sesion. Devuelve como cancelar.
 *
 * El `seq` de cada trozo son los bytes emitidos contando ya ese trozo: sirve
 * para descartar lo que ya venia dentro de una foto de `agentScrollback`.
 */
export const onAgentOutput = (
  id: string,
  handler: (data: string, seq: number) => void,
): Promise<UnlistenFn> =>
  listen<{ data: string; seq: number }>(`pty:${id}`, (e) => handler(e.payload.data, e.payload.seq))

/**
 * Se suscribe al contador de tokens de una sesion.
 *
 * Solo llega cuando el numero cambia, no con cada trozo de salida. Un CLI que
 * no publique su gasto no emite nunca.
 */
export const onAgentTokens = (
  id: string,
  handler: (total: number) => void,
): Promise<UnlistenFn> =>
  listen<{ total: number }>(`pty-tokens:${id}`, (e) => handler(e.payload.total))

export const onAgentExit = (id: string, handler: () => void): Promise<UnlistenFn> =>
  listen(`pty-exit:${id}`, () => handler())

/** Abre una carpeta en el explorador del sistema. */
export const revealInExplorer = (path: string) => invoke<void>('reveal_in_explorer', { path })

/** Deja un prompt largo en un archivo temporal y devuelve su ruta. */
export const savePrompt = (content: string) => invoke<string>('save_prompt', { content })

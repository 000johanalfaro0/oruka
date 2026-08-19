/**
 * Bus de comandos entre modulos.
 *
 * Existe para que un modulo pueda pedirle algo a otro sin importarlo. Ideas
 * emite `workspace.openWithAgent` y no sabe ni le importa como estan hechas las
 * terminales; si manana Workspace se reescribe entero, Ideas no se entera.
 *
 * El mapa de eventos es la unica superficie acoplada entre modulos, y esta
 * tipada a proposito para que romperla sea un error de compilacion.
 */
export interface BusEvents {
  /**
   * Abrir un proyecto y lanzar un agente en el, opcionalmente con contexto.
   *
   * Sin `cli` lo elige quien lo atienda: el que pide esto no tiene por que
   * saber que CLIs hay instalados en la maquina.
   */
  'workspace.openWithAgent': {
    projectPath: string
    cli?: string
    prompt?: string
  }
  /** Abrir un proyecto en una pestana, sin lanzar nada. */
  'workspace.openProject': { projectPath: string }
  /** Cambiar de modulo desde otro modulo. */
  'shell.activateModule': { moduleId: string }
  /** El proyecto activo cambio: GitHub escucha esto para seguirle. */
  'workspace.projectChanged': { projectPath: string | null }
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

const handlers = new Map<string, Set<Handler<never>>>()

/**
 * Intenciones que llegaron antes de que hubiera nadie para atenderlas.
 *
 * Los modulos se cargan en diferido: si GitHub pide abrir un proyecto con un
 * agente y el Workspace no se ha abierto todavia en esta sesion, su codigo ni
 * siquiera esta en memoria y un aviso normal se perderia. Se guarda una sola
 * por evento —la ultima gana— y se entrega en cuanto alguien se suscribe.
 */
const parked = new Map<string, unknown>()

export const bus = {
  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    let set = handlers.get(event)
    if (!set) {
      set = new Set()
      handlers.set(event, set)
    }
    set.add(handler as Handler<never>)

    // Habia una intencion esperando: se entrega y se consume, para que no
    // vuelva a dispararse al siguiente montaje.
    if (parked.has(event)) {
      const payload = parked.get(event) as BusEvents[K]
      parked.delete(event)
      handler(payload)
    }

    return () => {
      set!.delete(handler as Handler<never>)
    }
  },

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = handlers.get(event)
    if (!set) return
    for (const handler of set) {
      ;(handler as Handler<K>)(payload)
    }
  },

  /**
   * Como `emit`, pero para lo que hay que hacer si o si.
   *
   * Un aviso que nadie oye se tira, y esta bien: si nadie mira el proyecto
   * activo, da igual. Una peticion no: quien pulsa «abrir con un agente» espera
   * que ocurra aunque el modulo que lo atiende aun no este cargado. Por eso se
   * aparca hasta que alguien se suscriba.
   */
  request<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = handlers.get(event)
    if (set && set.size > 0) {
      for (const handler of set) {
        ;(handler as Handler<K>)(payload)
      }
      return
    }
    parked.set(event, payload)
  },
}

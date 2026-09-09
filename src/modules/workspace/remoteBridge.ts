import { agentWrite, onAgentOutput } from '@/lib/agents'
import { createRelay, type InputMessage, type RemoteSnapshot, type Relay } from '@/lib/relay'
import { storeGet, storeSet } from '@/lib/store'
import { getSupabase } from '@/lib/supabase'

/**
 * El lado PC del mando a distancia.
 *
 * Publica lo que esta pasando y teclea lo que llega del movil. Es el unico
 * sitio de la app donde una orden de fuera acaba entrando en un PTY, asi que
 * todo lo que hace se resume en dos frases:
 *
 * 1. Solo escribe en sesiones que existen ahora mismo en este Workspace. Una
 *    ruta o un CLI inventados no abren ni lanzan nada -y el movil puede pedir
 *    lanzar un agente, pero nunca elige el modo: siempre es el seguro.
 * 2. Solo funciona con el interruptor puesto, y el interruptor viene apagado.
 *
 * Vive FUERA de React. El shell desmonta el modulo que no esta activo, asi que
 * un puente montado dentro de un componente se cortaria en cuanto miraras
 * GitHub, y el movil se quedaria hablando solo.
 */

const CLAVE_HOST = 'oruka.remote.hostId'
const CLAVE_ACTIVO = 'oruka.remote.enabled'

/**
 * Cada cuanto se manda lo acumulado.
 *
 * Un agente vivo emite cientos de veces por segundo. Una peticion por trozo
 * tumbaria la conexion y la factura; medio segundo de retraso no se nota
 * leyendo, y convierte cientos de filas en una.
 */
const CADENCIA_MS = 500

/** Tope por envio. Si un agente vuelca un archivo entero, se recorta. */
const MAX_TEXTO = 8000

// ---------------------------------------------------------------------------
// Caracteres de control
//
// Van construidos desde su numero y no escritos tal cual. Un byte de control
// en el codigo fuente es invisible en cualquier editor: no se puede revisar,
// se pierde en un copiar y pegar descuidado, y cuando desaparece no falla
// nada, simplemente deja de funcionar. Escribirlo asi cuesta una linea y se
// puede leer en voz alta.
// ---------------------------------------------------------------------------

/** El que abre casi todas las secuencias de escape. */
const ESC = String.fromCharCode(27)
/** El pitido, que es como termina un titulo de ventana. */
const BEL = String.fromCharCode(7)

/** Teclas sueltas que el movil puede mandar. Nada mas: esto no es un teclado. */
const TECLAS: Record<string, string> = {
  enter: '\r',
  escape: ESC,
  interrupt: String.fromCharCode(3),
}

/** ESC [ ... letra final. La familia mas comun: color y mover el cursor. */
const CSI = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[@-~]', 'g')
/** ESC ] ... hasta el pitido o ESC barra. Titulos de ventana y enlaces. */
const OSC = new RegExp(ESC + '\\][^' + BEL + ESC + ']*(?:' + BEL + '|' + ESC + '\\\\)', 'g')
/** Lo que queda de un ESC con un solo caracter detras. */
const ESC_SIMPLE = new RegExp(ESC + '[@-Z\\\\-_]', 'g')

/**
 * Deja el texto legible en un telefono.
 *
 * El movil no pinta una terminal: pinta texto. Mandar los escapes tal cual
 * llenaria la pantalla de basura. Se limpia aqui y no en Rust para no tocar el
 * camino que ya funciona en el escritorio, donde xterm.js **si** los necesita.
 *
 * Del resto de caracteres se guardan el tabulador, el salto de linea y todo lo
 * imprimible. El retorno de carro suelto (sin el salto de linea detras) no se
 * borra sin mas: un agente lo usa para repintar la linea actual -un spinner,
 * texto que llega palabra a palabra- y borrarlo a secas pega cada repintado
 * detras del anterior en vez de reemplazarlo, dejando frases partidas y
 * repetidas. Aqui se interpreta: vuelve al principio de la linea en curso, que
 * es lo que un retorno de carro significa de verdad.
 */
export function limpiar(texto: string): string {
  const sinEscapes = texto.replace(CSI, '').replace(OSC, '').replace(ESC_SIMPLE, '')
  let salida = ''
  let inicioLinea = 0
  for (let i = 0; i < sinEscapes.length; i++) {
    const codigo = sinEscapes.charCodeAt(i)
    if (codigo === 13) {
      // \r\n de Windows: retorno normal, no repintado. Se deja pasar.
      if (sinEscapes[i + 1] !== '\n') salida = salida.slice(0, inicioLinea)
      continue
    }
    if (codigo === 10) {
      salida += '\n'
      inicioLinea = salida.length
      continue
    }
    if (codigo === 9 || (codigo >= 32 && codigo !== 127)) salida += sinEscapes[i]
  }
  return salida
}

// ---------------------------------------------------------------------------

/** Lo que el puente necesita saber del Workspace, sin importarlo. */
export interface BridgePort {
  /** La foto de ahora mismo: proyectos, agentes y actividad. */
  getSnapshot: () => RemoteSnapshot
  /** Avisa cuando esa foto cambia. Devuelve como dejar de escuchar. */
  subscribe: (fn: () => void) => () => void
  /** Un fallo que el usuario tiene que ver. Nunca se traga en silencio. */
  onError: (mensaje: string) => void
  /**
   * Abre o cierra una pestana de proyecto, a peticion del movil.
   *
   * Abrir una carpeta la deja lista; con `launchAgent` se le puede meter un
   * CLI encima, en el mismo pedido o despues. Cerrar mata los agentes que
   * tuviera -misma regla que cerrar la pestana a mano.
   */
  openProject: (path: string) => void
  closeProject: (path: string) => void
  /**
   * Lanza un CLI en un proyecto ya abierto, a peticion del movil.
   *
   * El modo es opcional y ya llega comprobado: quien llama aqui lo valido
   * contra `RemoteSnapshot.clis`, que nunca incluye "yolo".
   */
  launchAgent: (path: string, cliId: string, mode?: string) => void
}

interface Vivo {
  relay: Relay
  hostId: string
  puerto: BridgePort
  /** Como soltar cada cosa que se engancho. */
  sueltas: Array<() => void>
  /** Texto pendiente de mandar, por sesion. */
  cola: Map<string, { texto: string; seq: number }>
  /** Sesiones a las que ya se les escucha la salida. */
  enganchadas: Set<string>
  reloj: ReturnType<typeof setInterval> | null
}

let vivo: Vivo | null = null

/** El nombre con el que este equipo aparece en el movil. */
function nombreDeEquipo(): string {
  const plataforma = navigator.userAgent.includes('Windows') ? 'Windows' : 'este equipo'
  return `Oruka en ${plataforma}`
}

// ---------------------------------------------------------------------------

/** Si el usuario dejo el mando puesto la ultima vez. */
export async function estabaActivo(): Promise<boolean> {
  return (await storeGet(CLAVE_ACTIVO)) === '1'
}

/** Si el puente esta funcionando ahora mismo. */
export function estaEncendido(): boolean {
  return vivo !== null
}

/**
 * Enciende el mando y devuelve el id de este equipo en la nube.
 *
 * Si algo falla, se propaga: encender a medias y no decirlo dejaria al usuario
 * creyendo que su telefono manda cuando no manda.
 */
export async function encender(puerto: BridgePort): Promise<string> {
  if (vivo) return vivo.hostId

  const supabase = await getSupabase()
  const relay = createRelay(supabase)
  const hostId = await relay.registerHost(nombreDeEquipo(), await storeGet(CLAVE_HOST))
  await storeSet(CLAVE_HOST, hostId)
  await storeSet(CLAVE_ACTIVO, '1')

  const estado: Vivo = {
    relay,
    hostId,
    puerto,
    sueltas: [],
    cola: new Map(),
    enganchadas: new Set(),
    reloj: null,
  }
  vivo = estado

  await relay.setOnline(hostId, true)
  await relay.publishState(hostId, puerto.getSnapshot())

  // Lo que el movil dejo escrito mientras esto estaba apagado. Entregarlo tarde
  // es feo; perderlo en silencio es peor.
  for (const msg of await relay.pendingInput(hostId)) await aplicar(estado, msg)

  estado.sueltas.push(relay.onInput(hostId, (msg) => void aplicar(estado, msg)))
  estado.sueltas.push(
    puerto.subscribe(() => {
      engancharSesiones(estado)
      void relay.publishState(hostId, puerto.getSnapshot()).catch(() => {
        // Publicar la foto es informativo. Si falla una vez, la siguiente la
        // corrige; avisar en cada fallo de red seria ruido constante.
      })
    }),
  )

  engancharSesiones(estado)
  estado.reloj = setInterval(() => void vaciarCola(estado), CADENCIA_MS)
  return hostId
}

/**
 * Apaga el mando y lo deja marcado como apagado.
 *
 * Tambien al cerrar la app: dejar un equipo diciendo «estoy aqui» cuando ya no
 * esta hace que el movil escriba a nadie.
 */
export async function apagar(): Promise<void> {
  const estado = vivo
  vivo = null
  await storeSet(CLAVE_ACTIVO, '0')
  if (!estado) return

  if (estado.reloj) clearInterval(estado.reloj)
  for (const soltar of estado.sueltas) soltar()
  await estado.relay.setOnline(estado.hostId, false).catch(() => {})
}

// ---------------------------------------------------------------------------

/**
 * Escucha la salida de las sesiones que aun no se escuchaban.
 *
 * Es aparte de la escucha que ya hace el almacen para el gasto y la actividad:
 * son dos oyentes del mismo evento, y eso el sistema lo permite. Mezclarlos
 * ataria el mando a distancia a la barra de gasto, que no tienen nada que ver.
 */
function engancharSesiones(estado: Vivo) {
  for (const proyecto of estado.puerto.getSnapshot().projects) {
    for (const agente of proyecto.agents) {
      const id = agente.sessionId
      if (estado.enganchadas.has(id)) continue
      estado.enganchadas.add(id)
      void onAgentOutput(id, (data, seq) => {
        const previo = estado.cola.get(id)
        const texto = (previo?.texto ?? '') + data
        estado.cola.set(id, {
          // El seq son bytes emitidos hasta aqui: vale el del ultimo trozo.
          seq,
          texto: texto.length > MAX_TEXTO ? texto.slice(-MAX_TEXTO) : texto,
        })
      }).then((off) => estado.sueltas.push(off))
    }
  }
}

/** Manda de una vez lo acumulado en este medio segundo. */
async function vaciarCola(estado: Vivo) {
  if (estado.cola.size === 0) return
  const lote = [...estado.cola.entries()]
    .map(([session_id, { texto, seq }]) => ({ session_id, seq, text: limpiar(texto) }))
    .filter((c) => c.text.trim().length > 0)
  estado.cola.clear()
  if (lote.length === 0) return

  try {
    await estado.relay.publishOutput(estado.hostId, lote)
  } catch {
    // Un corte de red no puede tumbar la app ni llenar la pantalla de avisos.
    // Lo que no llego se pierde; el movil lo nota por el salto en el contador y
    // vuelve a pedir desde su ultimo punto.
  }
}

/**
 * Mete en el PTY lo que llego del movil.
 *
 * Aqui esta la unica puerta de entrada desde fuera, y por eso lo primero que
 * hace es comprobar que esa sesion existe de verdad en este Workspace.
 */
async function aplicar(estado: Vivo, msg: InputMessage): Promise<void> {
  if (msg.applied_at) return

  // Ordenes de workspace: no tocan ninguna sesion, asi que se atienden aparte
  // y no pasan por la comprobacion de sessionId de aqui abajo.
  if (msg.kind === 'open_project' || msg.kind === 'close_project') {
    // Mismo principio que con las sesiones: una ruta inventada no hace nada,
    // ni abre ni cierra, en vez de intentarlo a ciegas.
    const foto = estado.puerto.getSnapshot()
    const conocida =
      msg.kind === 'open_project'
        ? foto.closedProjects.some((p) => p.path === msg.body)
        : foto.projects.some((p) => p.path === msg.body)
    if (conocida) {
      try {
        if (msg.kind === 'open_project') estado.puerto.openProject(msg.body)
        else estado.puerto.closeProject(msg.body)
      } catch (e) {
        estado.puerto.onError(
          `No se pudo ${msg.kind === 'open_project' ? 'abrir' : 'cerrar'} la carpeta: ${String(e)}`,
        )
      }
    }
    await estado.relay.markApplied([msg.id]).catch(() => {})
    return
  }

  if (msg.kind === 'launch_agent') {
    // Ni la ruta, ni el CLI, ni el modo se confian a ciegas: los tres tienen
    // que estar ya en la foto que este mismo Workspace publico -un proyecto
    // abierto de verdad, un CLI instalado de verdad, y un modo que de verdad
    // este en su lista -que nunca incluye "yolo", ver `snapshot()`.
    const foto = estado.puerto.getSnapshot()
    try {
      const { path, cli, mode } = JSON.parse(msg.body) as {
        path?: unknown
        cli?: unknown
        mode?: unknown
      }
      const proyectoConocido = typeof path === 'string' && foto.projects.some((p) => p.path === path)
      const cliEntry = typeof cli === 'string' ? foto.clis.find((c) => c.id === cli) : undefined
      const modoConocido =
        typeof mode !== 'string' || !mode ? true : (cliEntry?.modes.includes(mode) ?? false)
      if (proyectoConocido && cliEntry && modoConocido) {
        estado.puerto.launchAgent(path as string, cliEntry.id, typeof mode === 'string' ? mode : undefined)
      }
    } catch (e) {
      estado.puerto.onError(`No se pudo lanzar el agente: ${String(e)}`)
    }
    await estado.relay.markApplied([msg.id]).catch(() => {})
    return
  }

  const existe = estado.puerto
    .getSnapshot()
    .projects.some((p) => p.agents.some((a) => a.sessionId === msg.session_id))

  // Una sesion desconocida o una tecla que no esta en la lista se marcan como
  // atendidas igualmente: si no, se reintentarian para siempre.
  const datos = !existe ? null : msg.kind === 'key' ? (TECLAS[msg.body] ?? null) : `${msg.body}\r`
  if (!datos) {
    await estado.relay.markApplied([msg.id]).catch(() => {})
    return
  }

  try {
    await agentWrite(msg.session_id, datos)
    await estado.relay.markApplied([msg.id])
  } catch (e) {
    estado.puerto.onError(`No se pudo escribir en el agente: ${String(e)}`)
  }
}

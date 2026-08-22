import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import {
  agentResize,
  agentScrollback,
  agentSpawn,
  agentWrite,
  onAgentExit,
  onAgentOutput,
} from '@/lib/agents'
import '@xterm/xterm/css/xterm.css'

/** Paleta ANSI de VS Code, para que un agente se vea igual dentro que fuera. */
const VSCODE_THEME = {
  background: '#1f1f1f',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

/**
 * Sesiones ya lanzadas.
 *
 * Un id de sesion se lanza UNA vez en toda la vida de la app. Sin esto, cada
 * remontaje del componente (cambiar de pestana, o el doble efecto de React en
 * desarrollo) arrancaba un segundo proceso con el mismo id y el primero quedaba
 * huerfano.
 */
const started = new Set<string>()

interface Props {
  sessionId: string
  cliId: string
  cwd: string
  mode: string
  prompt?: string
  /**
   * Retomar la conversacion en vez de empezar una nueva.
   *
   * Se pone al restaurar una sesion tras cerrar la app. El prompt inicial no se
   * reenvia en ese caso: ya se mando en su dia, y repetirlo confundiria a un
   * agente que cree estar continuando lo de antes.
   */
  resume?: boolean
}

/**
 * Un agente corriendo. El componente solo pinta y manda teclas: el proceso vive
 * en Rust y sobrevive a que este panel se oculte.
 */
export function AgentTerminal({ sessionId, cliId, cwd, mode, prompt, resume }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      theme: VSCODE_THEME,
      cursorBlink: true,
      // Acotado a proposito: el scrollback ilimitado es una fuga lenta.
      scrollback: 5000,
      allowProposedApi: true,
    })
    const cleanups: Array<() => void> = []
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    /**
     * Pintar por GPU en vez de por DOM.
     *
     * Sin esto, xterm dibuja cada caracter como elementos del documento, y con
     * cuatro terminales escupiendo texto a la vez eso hunde una maquina
     * modesta. El addon estaba instalado desde el principio pero **no se
     * cargaba nunca**, asi que se estaba pagando el renderizador lento sin
     * saberlo.
     *
     * Va con red: en equipos con graficos viejos o sin aceleracion, crear el
     * contexto falla, y ahi hay que dejar que xterm siga con el suyo de
     * siempre en vez de quedarse sin terminal. Y si el contexto se pierde
     * mientras corre —pasa al suspender el portatil— se descarta el addon y
     * xterm vuelve solo al camino lento.
     */
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
      cleanups.push(() => webgl.dispose())
    } catch {
      // Sin aceleracion. Se pinta mas lento, pero se pinta.
    }

    fit.fit()

    let alive = true
    let ready = false

    /**
     * Bytes ya pintados. Hasta saberlo, lo que llega se encola en vez de
     * pintarse: si se pintara y luego llegara la foto que ya lo contenia,
     * saldria dos veces.
     */
    let pintadoHasta: number | null = null
    const encolados: Array<{ data: string; seq: number }> = []

    /** A partir de aqui se pinta en directo, tirando lo que ya estaba puesto. */
    const abrirElGrifo = (hasta: number) => {
      pintadoHasta = hasta
      for (const trozo of encolados) {
        if (trozo.seq > hasta) term.write(trozo.data)
      }
      encolados.length = 0
    }

    const start = async () => {
      const unlistenOut = await onAgentOutput(sessionId, (data, seq) => {
        if (!alive) return
        if (pintadoHasta === null) encolados.push({ data, seq })
        else if (seq > pintadoHasta) term.write(data)
      })
      const unlistenExit = await onAgentExit(sessionId, () => {
        if (alive) term.write('\r\n\x1b[90m-- el agente termino --\x1b[0m\r\n')
        started.delete(sessionId)
      })
      cleanups.push(unlistenOut, unlistenExit)
      if (!alive) return

      if (!started.has(sessionId)) {
        started.add(sessionId)
        try {
          await agentSpawn({
            id: sessionId,
            cliId,
            cwd,
            mode,
            cols: term.cols,
            rows: term.rows,
            // Al retomar no se reenvia el prompt: el agente ya lo tiene.
            prompt: resume ? undefined : prompt,
            resume,
          })
        } catch (e) {
          started.delete(sessionId)
          abrirElGrifo(0)
          term.write(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
          return
        }
        // Sesion nueva: no hay nada anterior, todo lo encolado es suyo.
        abrirElGrifo(0)
      } else {
        // Ya estaba corriendo: se repinta lo que dijo mientras no se veia.
        const foto = await agentScrollback(sessionId).catch(() => null)
        if (!alive) return
        if (foto) {
          term.write(foto.data)
          abrirElGrifo(foto.seq)
        } else {
          // La sesion murio entre medias; el evento de salida ya lo dira.
          abrirElGrifo(0)
        }
      }

      ready = true
      term.onData((data) => void agentWrite(sessionId, data))
      void agentResize(sessionId, term.cols, term.rows)
    }

    void start()

    const observer = new ResizeObserver(() => {
      if (!alive || host.clientWidth === 0) return
      fit.fit()
      // Solo despues de lanzar: antes no hay sesion a la que redimensionar.
      if (ready) void agentResize(sessionId, term.cols, term.rows)
    })
    observer.observe(host)

    return () => {
      alive = false
      observer.disconnect()
      cleanups.forEach((fn) => fn())
      term.dispose()
    }
  }, [sessionId, cliId, cwd, mode, prompt, resume])

  return <div className="agent-term__host" ref={hostRef} />
}

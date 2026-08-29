import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
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
import { useContextMenu, type MenuItem } from '@/shared/ContextMenu'
import '@xterm/xterm/css/xterm.css'

/** Paleta ANSI inspirada en el tema oscuro de Antigravity. */
const ANTIGRAVITY_THEME = {
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: '#ffffff',
  selectionBackground: 'rgba(77, 120, 204, 0.35)',
  black: '#161616',
  red: '#ea4335',
  green: '#34a853',
  yellow: '#fbbc04',
  blue: '#4d78cc',
  magenta: '#c58af9',
  cyan: '#24c1e0',
  white: '#f1f3f4',
  brightBlack: '#5f6368',
  brightRed: '#f28b82',
  brightGreen: '#81c995',
  brightYellow: '#fdd663',
  brightBlue: '#8ab4f8',
  brightMagenta: '#d7aefb',
  brightCyan: '#78d9ec',
  brightWhite: '#ffffff',
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
  const termRef = useRef<Terminal | null>(null)
  const { open: openContext, menu } = useContextMenu()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      theme: ANTIGRAVITY_THEME,
      cursorBlink: true,
      // Acotado a proposito: el scrollback ilimitado es una fuga lenta.
      scrollback: 5000,
      allowProposedApi: true,
    })
    termRef.current = term
    const cleanups: Array<() => void> = []
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    /**
     * Soporte de copiar y pegar en la terminal:
     *
     * 1. Teclas rapidas:
     *    - Ctrl+C / Cmd+C: si hay seleccion, copia al portapapeles y NO interrumpe al agente
     *      (evita mandar \x03 al PTY). Si no hay seleccion, pasa \x03 (SIGINT) para interrumpir.
     *    - Ctrl+Shift+C: copia la seleccion al portapapeles.
     *    - Ctrl+V / Cmd+V / Ctrl+Shift+V / Shift+Insert: lee del portapapeles y pega usando
     *      term.paste (evita que xterm mande el byte crudo \x16 y respeta bracketed paste).
     *    - Ctrl+A / Cmd+A: selecciona todo el texto de la terminal.
     */
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // Copiar con Ctrl+C / Cmd+C o Ctrl+Shift+C
      if (isCtrlOrCmd && key === 'c') {
        if (term.hasSelection()) {
          if (e.type === 'keydown') {
            const selection = term.getSelection()
            if (selection) {
              void navigator.clipboard.writeText(selection)
            }
          }
          // Bloquear que xterm mande \x03 al proceso cuando solo se queria copiar texto
          return false
        }
        // Sin seleccion: deja pasar Ctrl+C para mandar \x03 (interrumpir agente)
        return true
      }

      // Pegar con Ctrl+V / Cmd+V o Ctrl+Shift+V o Shift+Insert
      const isPaste =
        (isCtrlOrCmd && !e.altKey && key === 'v') ||
        (e.shiftKey && (e.key === 'Insert' || key === 'v'))

      if (isPaste) {
        if (e.type === 'keydown') {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text && alive) {
                term.paste(text)
              }
            })
            .catch(() => {})
        }
        return false
      }

      // Seleccionar todo con Ctrl+A / Cmd+A
      if (isCtrlOrCmd && !e.shiftKey && !e.altKey && key === 'a') {
        if (e.type === 'keydown') {
          term.selectAll()
        }
        return false
      }

      return true
    })

    // 2. Evento nativo de pegado en el contenedor (captura pegado por menu o eventos del SO):
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const text = e.clipboardData?.getData('text')
      if (text) {
        term.paste(text)
      } else {
        navigator.clipboard
          .readText()
          .then((clipText) => {
            if (clipText && alive) term.paste(clipText)
          })
          .catch(() => {})
      }
    }
    host.addEventListener('paste', handlePaste)
    cleanups.push(() => host.removeEventListener('paste', handlePaste))

    // 3. Clic central (rueda del raton) para pegar texto del portapapeles:
    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text && alive) term.paste(text)
          })
          .catch(() => {})
      }
    }
    host.addEventListener('auxclick', handleAuxClick)
    cleanups.push(() => host.removeEventListener('auxclick', handleAuxClick))

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

    term.onData((data) => {
      if (alive && ready) {
        void agentWrite(sessionId, data)
      }
    })

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
      termRef.current = null
      observer.disconnect()
      cleanups.forEach((fn) => fn())
      term.dispose()
    }
  }, [sessionId, cliId, cwd, mode, prompt, resume])

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    const term = termRef.current
    if (!term) return

    const hasSelection = term.hasSelection()
    const items: MenuItem[] = [
      {
        label: 'Copiar',
        icon: 'copy',
        disabled: !hasSelection,
        action: () => {
          const sel = term.getSelection()
          if (sel) {
            void navigator.clipboard.writeText(sel)
          }
        },
      },
      {
        label: 'Pegar',
        icon: 'clippy',
        action: () => {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) term.paste(text)
            })
            .catch(() => {})
        },
      },
      {
        label: 'Seleccionar todo',
        icon: 'selection',
        action: () => term.selectAll(),
      },
      {},
      {
        label: 'Limpiar terminal',
        icon: 'clear-all',
        action: () => term.clear(),
      },
    ]
    openContext(e, items)
  }

  return (
    <div className="agent-term__host" ref={hostRef} onContextMenu={handleContextMenu}>
      {menu}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createRelay, type Relay } from '@/lib/relay'
import { getSupabase } from '@/lib/supabase'
import type { ChatTarget } from '../App'

/**
 * Cuanto texto se guarda en pantalla.
 *
 * Un agente puede escupir un archivo entero. Sin tope, el telefono se queda sin
 * memoria y la pagina muere sin decir nada.
 */
const MAX_PANTALLA = 40000

/**
 * La conversacion con un agente que corre en el PC.
 *
 * Lo que se escribe aqui no se ejecuta aqui: se deja en la nube y el PC lo
 * teclea en la sesion de verdad. Por eso puede tardar un segundo, y por eso no
 * funciona si el mando esta apagado en el ordenador.
 */
export function Chat({ target, onVolver }: { target: ChatTarget; onVolver: () => void }) {
  const [texto, setTexto] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const relayRef = useRef<Relay | null>(null)
  /** El ultimo trozo que ya se tiene. Es lo que evita leer dos veces lo mismo. */
  const seqRef = useRef(0)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let soltar: (() => void) | null = null
    let vivo = true

    void (async () => {
      try {
        const relay = createRelay(await getSupabase())
        relayRef.current = relay

        /** Trae lo que falte desde el ultimo trozo conocido. */
        const ponerseAlDia = async () => {
          const trozos = await relay.readOutput(target.hostId, target.sessionId, seqRef.current)
          if (!vivo || trozos.length === 0) return
          for (const t of trozos) if (t.seq > seqRef.current) seqRef.current = t.seq
          const anadido = trozos.map((t) => t.text).join('')
          setTexto((previo) => (previo + anadido).slice(-MAX_PANTALLA))
        }

        await ponerseAlDia()
        if (!vivo) return
        setCargando(false)

        soltar = relay.onOutput(
          target.hostId,
          target.sessionId,
          (trozo) => {
            // Puede llegar por el canal algo que ya vino en la puesta al dia.
            if (trozo.seq <= seqRef.current) return
            seqRef.current = trozo.seq
            setTexto((previo) => (previo + trozo.text).slice(-MAX_PANTALLA))
          },
          // Al engancharse (tambien tras recuperar la red) se rellena el hueco.
          () => void ponerseAlDia(),
        )
      } catch (e) {
        if (vivo) {
          setError(e instanceof Error ? e.message : String(e))
          setCargando(false)
        }
      }
    })()

    return () => {
      vivo = false
      soltar?.()
    }
  }, [target.hostId, target.sessionId])

  // Seguir al final, que es donde esta lo nuevo.
  useEffect(() => {
    const caja = logRef.current
    if (caja) caja.scrollTop = caja.scrollHeight
  }, [texto])

  const mandar = async (cuerpo: string, tipo: 'text' | 'key') => {
    const relay = relayRef.current
    if (!relay || !cuerpo) return
    setEnviando(true)
    setError(null)
    try {
      await relay.sendInput(target.hostId, target.sessionId, cuerpo, tipo)
      if (tipo === 'text') setMensaje('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="chat">
      <header className="topbar">
        <button type="button" className="topbar__back" onClick={onVolver} aria-label="Volver">
          ‹
        </button>
        <span className="topbar__title">{target.agentName}</span>
        <span className="topbar__sub">{target.projectName}</span>
      </header>

      <pre className="chat__log" ref={logRef}>
        {cargando ? 'Cargando lo que ha dicho…' : texto || 'Este agente no ha dicho nada todavía.'}
      </pre>

      {error && <p className="error">{error}</p>}

      {/* Dos teclas y solo dos: salir de un menu y parar lo que este haciendo.
          Un teclado entero en el movil seria un juguete peligroso. */}
      <div className="chat__keys">
        <button type="button" className="key" onClick={() => void mandar('escape', 'key')}>
          Esc
        </button>
        <button type="button" className="key" onClick={() => void mandar('interrupt', 'key')}>
          Parar
        </button>
      </div>

      <div className="composer">
        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          placeholder="Escríbele al agente…"
          rows={1}
        />
        <button
          type="button"
          disabled={enviando || mensaje.trim().length === 0}
          onClick={() => void mandar(mensaje.trim(), 'text')}
        >
          Enviar
        </button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { canjear } from '../pairing'

/**
 * Vincular este telefono escaneando el codigo del ordenador.
 *
 * El lector de codigos es el del propio sistema, no una libreria: Android lo
 * trae desde hace anos y meter un decodificador en el paquete solo para esto
 * seria pagar peso por algo que ya esta. Donde no exista, el codigo se escribe
 * a mano, que por eso son doce letras legibles y no un churro.
 */

/** Lo minimo que hace falta del lector del sistema. */
interface Lector {
  detect(fuente: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
type FabricaLector = new (opciones: { formats: string[] }) => Lector

function hayLector(): FabricaLector | null {
  const g = window as unknown as { BarcodeDetector?: FabricaLector }
  return g.BarcodeDetector ?? null
}

/** Cada cuanto se mira la imagen. Tres veces por segundo sobra y no calienta. */
const RITMO_MS = 320

export function Pair({
  onEntrar,
  onUsarCorreo,
}: {
  onEntrar: () => void
  onUsarCorreo: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mirando, setMirando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Se guarda en una caja para que la camara no se reinicie al repintar. */
  const entrarRef = useRef<(texto: string) => Promise<void>>(async () => {})

  const entrar = async (texto: string) => {
    setOcupado(true)
    setError(null)
    try {
      await canjear(texto)
      onEntrar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }
  entrarRef.current = entrar

  // La camara. Se enciende solo cuando se pide y se apaga al salir: una camara
  // encendida de fondo es de las cosas que peor sientan en un telefono.
  useEffect(() => {
    if (!mirando) return
    const Fabrica = hayLector()
    if (!Fabrica) {
      setError('Este teléfono no sabe leer códigos solo. Escribe el código a mano.')
      setMirando(false)
      return
    }

    let flujo: MediaStream | null = null
    let reloj: ReturnType<typeof setInterval> | null = null
    let vivo = true

    void (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!vivo) return
        const video = videoRef.current
        if (!video) return
        video.srcObject = flujo
        await video.play()

        const lector = new Fabrica({ formats: ['qr_code'] })
        reloj = setInterval(() => {
          void (async () => {
            try {
              const hallazgos = await lector.detect(video)
              const primero = hallazgos[0]?.rawValue
              // Solo lo nuestro: en una pantalla puede haber otros codigos.
              if (!primero || !/^oruka:/i.test(primero)) return
              if (reloj) clearInterval(reloj)
              setMirando(false)
              await entrarRef.current(primero)
            } catch {
              // Un fotograma ilegible no es un error: llega otro enseguida.
            }
          })()
        }, RITMO_MS)
      } catch {
        if (vivo) {
          setError('No se pudo abrir la cámara. Escribe el código a mano.')
          setMirando(false)
        }
      }
    })()

    return () => {
      vivo = false
      if (reloj) clearInterval(reloj)
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [mirando])

  return (
    <div className="login">
      <h1 className="login__brand">Oruka</h1>
      <p className="login__hint">
        En el ordenador, abre <strong>Móvil</strong> y pulsa «Generar código».
      </p>

      {mirando ? (
        <>
          <video className="camara" ref={videoRef} playsInline muted />
          <button type="button" className="secundario" onClick={() => setMirando(false)}>
            Cancelar
          </button>
        </>
      ) : (
        <button type="button" className="primary" onClick={() => setMirando(true)}>
          Escanear
        </button>
      )}

      <label className="field">
        <span>O escribe el código</span>
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ABCDEFGHJKMN"
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={ocupado || codigo.trim().length === 0}
        onClick={() => void entrar(codigo)}
      >
        {ocupado ? 'Vinculando…' : 'Vincular'}
      </button>

      <button type="button" className="secundario" onClick={onUsarCorreo}>
        Entrar con correo y contraseña
      </button>
    </div>
  )
}
